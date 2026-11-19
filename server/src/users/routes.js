// Gestão de usuários (somente admin master) e "Meu perfil" (qualquer usuário logado).
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { publicUserSelect, requireMaster } from '../auth/middleware.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { setSessionCookie } from '../auth/session.js';
import { parseName, parsePassword, parsePhone, parseUsername } from './validation.js';
import { codeCheckLimiter, codeSendLimiters } from '../signup/limits.js';
import {
  checkVerificationCode,
  maskPhone,
  sendCodeError,
  sendVerificationCode,
} from '../signup/verification.js';

const USERNAME_TAKEN = 'Já existe um usuário com esse nome de usuário';

function isUniqueViolation(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Valida os campos enviados. Em `partial`, só valida o que veio (edição);
 * senha vazia na edição significa "não alterar".
 */
async function readUserInput(body, { partial }) {
  const data = {};
  const errors = {};
  const check = (field, result) => {
    if (result.error) errors[field] = result.error;
    else data[field] = result.value;
  };

  if (!partial || body.name !== undefined) check('name', parseName(body.name));
  if (!partial || body.username !== undefined) check('username', parseUsername(body.username));
  if (!partial || body.phone !== undefined) check('phone', parsePhone(body.phone));
  if (!partial || (body.password !== undefined && body.password !== '')) {
    const result = parsePassword(body.password);
    if (result.error) errors.password = result.error;
    else {
      data.passwordHash = await hashPassword(result.value);
      // Senha redefinida pelo admin: derruba as sessões abertas desse usuário
      if (partial) data.sessionVersion = { increment: 1 };
    }
  }

  return { data, errors };
}

function validationError(res, errors) {
  return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
}

const USER_NOT_FOUND = 'Usuário não encontrado';
const NOT_PENDING = 'Este usuário não está aguardando aprovação';

/**
 * Confirmação do telefone quando o número muda. `trusted`: quem definiu o número é
 * confiável (o master, ou um usuário criado por ele) e o número já vale confirmado;
 * senão (cadastro), precisa de um código novo.
 */
function phoneChange(phone, { trusted }) {
  return { phoneVerifiedAt: phone && trusted ? new Date() : null };
}

function appLink(pathname = '') {
  return `${String(process.env.APP_URL || '').replace(/\/+$/, '')}${pathname}`;
}

export function usersRouter({ send }) {
  const router = Router();
  router.use(requireMaster);

  router.get('/', async (_req, res) => {
    const users = await prisma.user.findMany({
      select: publicUserSelect,
      orderBy: [{ isMaster: 'desc' }, { name: 'asc' }],
    });
    res.json({ users });
  });

  router.post('/', async (req, res) => {
    const { data, errors } = await readUserInput(req.body ?? {}, { partial: false });
    if (Object.keys(errors).length) return validationError(res, errors);
    try {
      // Usuários criados aqui nunca são master: só administram os próprios dados.
      const user = await prisma.user.create({
        data: { ...data, ...phoneChange(data.phone, { trusted: true }), isMaster: false },
        select: publicUserSelect,
      });
      res.status(201).json({ user });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res
          .status(409)
          .json({ error: USERNAME_TAKEN, fields: { username: USERNAME_TAKEN } });
      }
      throw err;
    }
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Usuário não encontrado' });

    const { data, errors } = await readUserInput(req.body ?? {}, { partial: true });
    if (Object.keys(errors).length) return validationError(res, errors);

    const current = await prisma.user.findUnique({ where: { id }, select: { phone: true } });
    if (!current) return res.status(404).json({ error: USER_NOT_FOUND });
    // Telefone trocado pelo master já vale confirmado; o mesmo número não muda nada
    if (data.phone !== undefined && data.phone !== current.phone) {
      Object.assign(data, phoneChange(data.phone, { trusted: true }));
      await prisma.phoneVerification.deleteMany({ where: { userId: id } });
    }

    try {
      const user = await prisma.user.update({ where: { id }, data, select: publicUserSelect });
      res.json({ user });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res
          .status(409)
          .json({ error: USERNAME_TAKEN, fields: { username: USERNAME_TAKEN } });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }
      throw err;
    }
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Você não pode excluir o próprio usuário' });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { isMaster: true } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.isMaster) {
      return res.status(400).json({ error: 'O administrador master não pode ser excluído' });
    }

    // Atividades e execuções do usuário vão junto (onDelete: Cascade)
    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  });

  // Quantos cadastros aguardam aprovação (contador da aba "Usuários")
  router.get('/pending-count', async (_req, res) => {
    const count = await prisma.user.count({ where: { status: 'pendente' } });
    res.json({ count });
  });

  router.post('/:id/approve', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: USER_NOT_FOUND });
    const { count } = await prisma.user.updateMany({
      where: { id, status: 'pendente' },
      data: { status: 'ativo' },
    });
    const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    if (!user) return res.status(404).json({ error: USER_NOT_FOUND });
    if (count === 0) return res.status(409).json({ error: NOT_PENDING });

    // Avisa a pessoa (só se o número já foi confirmado por ela)
    if (user.phone && user.phoneVerifiedAt) {
      const text = `Sua conta no Goals foi aprovada! Entre com o usuário @${user.username} em ${appLink('/login')}`;
      Promise.resolve()
        .then(() => send(user.phone, text))
        .catch((err) => console.error('[usuarios] falha ao avisar aprovação:', err.message));
    }
    res.json({ user });
  });

  // Recusar apaga a conta pendente (o nome de usuário fica livre de novo)
  router.post('/:id/reject', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: USER_NOT_FOUND });
    const { count } = await prisma.user.deleteMany({
      where: { id, status: 'pendente', isMaster: false },
    });
    if (count === 0) {
      const exists = await prisma.user.count({ where: { id } });
      return exists
        ? res.status(409).json({ error: NOT_PENDING })
        : res.status(404).json({ error: USER_NOT_FOUND });
    }
    res.status(204).end();
  });

  return router;
}

// Troca de senha: 5 tentativas erradas por minuto por usuário (evita adivinhar a senha
// atual com uma sessão roubada). Trocas bem-sucedidas não contam.
const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de alterar a senha. Aguarde um minuto e tente novamente.' },
});

const isChangingPassword = (body) =>
  typeof body?.newPassword === 'string' && body.newPassword !== '';

/** "Meu perfil": o próprio usuário altera telefone e senha. */
export function profileRouter({ send }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ user: req.user });
  });

  router.put(
    '/',
    (req, res, next) =>
      isChangingPassword(req.body) ? passwordChangeLimiter(req, res, next) : next(),
    async (req, res) => {
      const body = req.body ?? {};
      const data = {};
      const errors = {};

      if (body.phone !== undefined) {
        const result = parsePhone(body.phone);
        if (result.error) errors.phone = result.error;
        else data.phone = result.value;
      }

      const changingPassword = isChangingPassword(body);
      if (changingPassword) {
        const result = parsePassword(body.newPassword);
        if (result.error) errors.newPassword = result.error;
        if (typeof body.currentPassword !== 'string' || !body.currentPassword) {
          errors.currentPassword = 'Informe a senha atual';
        }
      }
      if (Object.keys(errors).length) return validationError(res, errors);

      // Telefone novo: quem se cadastrou sozinho precisa confirmar o número de novo
      // (evita usar o número de outra pessoa); quem o master criou segue confiável.
      if (data.phone !== undefined && data.phone !== req.user.phone) {
        Object.assign(
          data,
          phoneChange(data.phone, { trusted: req.user.createdBy !== 'cadastro' }),
        );
        await prisma.phoneVerification.deleteMany({ where: { userId: req.user.id } });
      }

      if (changingPassword) {
        const current = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { passwordHash: true },
        });
        if (!(await verifyPassword(body.currentPassword, current.passwordHash))) {
          const error = 'Senha atual incorreta';
          return res.status(400).json({ error, fields: { currentPassword: error } });
        }
        data.passwordHash = await hashPassword(body.newPassword);
        // Derruba as outras sessões; esta recebe um cookie novo logo abaixo
        data.sessionVersion = { increment: 1 };
      }

      const { sessionVersion, ...user } = await prisma.user.update({
        where: { id: req.user.id },
        data,
        select: { ...publicUserSelect, sessionVersion: true },
      });
      if (changingPassword) setSessionCookie(res, { ...user, sessionVersion }); // renova a sessão atual
      res.json({ user });
    },
  );

  // Confirmação do telefone pelo próprio usuário (ex.: trocou o número no perfil)
  // Antes dos limites: um pedido sem nada a confirmar não gasta o limite do IP
  const requireUnverifiedPhone = (req, res, next) => {
    if (req.user.phone && !req.user.phoneVerifiedAt) return next();
    res.status(409).json({ error: 'Não há telefone para confirmar' });
  };

  router.post('/phone/send-code', requireUnverifiedPhone, ...codeSendLimiters, async (req, res) => {
    const result = await sendVerificationCode(req.user, send);
    if (result.retryAfter) {
      return res.status(429).json({
        error: 'Aguarde para pedir outro código.',
        retryAfter: result.retryAfter,
      });
    }
    res.json({ phone: maskPhone(req.user.phone), ...result });
  });

  router.post('/phone/verify', requireUnverifiedPhone, codeCheckLimiter, async (req, res) => {
    const result = await checkVerificationCode(req.user, req.body?.code);
    if (!result.ok) return sendCodeError(res, result);
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: publicUserSelect,
    });
    res.json({ user });
  });

  return router;
}
