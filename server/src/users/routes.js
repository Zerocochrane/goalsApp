// Gestão de usuários (somente admin master) e "Meu perfil" (qualquer usuário logado).
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { publicUserSelect, requireMaster } from '../auth/middleware.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { setSessionCookie } from '../auth/session.js';
import { parseName, parsePassword, parsePhone, parseUsername } from './validation.js';

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
    else data.passwordHash = await hashPassword(result.value);
  }

  return { data, errors };
}

function validationError(res, errors) {
  return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
}

export function usersRouter() {
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
        data: { ...data, isMaster: false },
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

  return router;
}

/** "Meu perfil": o próprio usuário altera telefone e senha. */
export function profileRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ user: req.user });
  });

  router.put('/', async (req, res) => {
    const body = req.body ?? {};
    const data = {};
    const errors = {};

    if (body.phone !== undefined) {
      const result = parsePhone(body.phone);
      if (result.error) errors.phone = result.error;
      else data.phone = result.value;
    }

    const changingPassword = typeof body.newPassword === 'string' && body.newPassword !== '';
    if (changingPassword) {
      const result = parsePassword(body.newPassword);
      if (result.error) errors.newPassword = result.error;
      if (typeof body.currentPassword !== 'string' || !body.currentPassword) {
        errors.currentPassword = 'Informe a senha atual';
      }
    }
    if (Object.keys(errors).length) return validationError(res, errors);

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
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: publicUserSelect,
    });
    if (changingPassword) setSessionCookie(res, user); // renova a sessão atual
    res.json({ user });
  });

  return router;
}
