// Cadastro pela própria pessoa (rotas públicas, sem login):
//   GET  /api/signup/config        → modo atual (mostra ou não o link "Criar conta")
//   POST /api/signup               → cria a conta (pendente) e envia o código
//   POST /api/signup/verify-phone  → confere o código; no modo aberto já entra no app
//   POST /api/signup/resend-code   → novo código (1 por minuto)
import crypto from 'node:crypto';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { publicUserSelect } from '../auth/middleware.js';
import { hashPassword } from '../auth/password.js';
import { setSessionCookie } from '../auth/session.js';
import { parseName, parsePassword, parsePhone, parseUsername } from '../users/validation.js';
import { signupMode } from './config.js';
import { codeCheckLimiter, codeSendLimiters, signupLimiter } from './limits.js';
import { createTicket, readTicket } from './ticket.js';
import {
  checkVerificationCode,
  maskPhone,
  secondsUntilResend,
  sendCodeError,
  sendVerificationCode,
} from './verification.js';

export const USERNAME_IN_USE = 'Este nome de usuário já está em uso';
export const SIGNUP_DISABLED = 'O cadastro está desativado. Peça uma conta ao administrador.';
const TICKET_INVALID =
  'Sua sessão de cadastro expirou. Entre com seu usuário e senha para continuar.';
// Campo isca: invisível para pessoas; robôs costumam preencher todos os campos
export const HONEYPOT_FIELD = 'website';

function validationError(res, errors) {
  return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
}

/** Aviso ao master (pelo WhatsApp) de que há um cadastro aguardando aprovação. */
async function notifyMasters(user, send) {
  const masters = await prisma.user.findMany({
    where: { isMaster: true, phone: { not: null }, phoneVerifiedAt: { not: null } },
    select: { phone: true },
  });
  const link = `${String(process.env.APP_URL || '').replace(/\/+$/, '')}/usuarios`;
  const text = `Novo cadastro aguardando aprovação no Goals: *${user.name}* (@${user.username}). Aprove ou recuse em ${link}`;
  for (const { phone } of masters) {
    Promise.resolve()
      .then(() => send(phone, text))
      .catch((err) => console.error('[cadastro] falha ao avisar o master:', err.message));
  }
}

/** Usuário do ticket que ainda está confirmando o telefone, ou null. */
async function userFromTicket(ticket) {
  const userId = readTicket(ticket);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.createdBy !== 'cadastro' || user.phoneVerifiedAt || !user.phone) return null;
  return user;
}

/** Resposta usada após o cadastro e pelo login de quem ainda não confirmou o telefone. */
export async function pendingPhoneResponse(user) {
  const verification = await prisma.phoneVerification.findUnique({ where: { userId: user.id } });
  return {
    ticket: createTicket(user),
    phone: maskPhone(user.phone),
    resendIn: secondsUntilResend(verification),
  };
}

export function signupRouter({ send }) {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json({ mode: signupMode() });
  });

  router.post('/', signupLimiter, ...codeSendLimiters, async (req, res) => {
    const mode = signupMode();
    if (mode === 'desligado') return res.status(403).json({ error: SIGNUP_DISABLED });
    const body = req.body ?? {};

    const data = {};
    const errors = {};
    const check = (field, result) => {
      if (result.error) errors[field] = result.error;
      else data[field] = result.value;
    };
    check('name', parseName(body.name));
    check('username', parseUsername(body.username));
    check('password', parsePassword(body.password));
    if (!errors.password && body.passwordConfirm !== body.password) {
      errors.passwordConfirm = 'As senhas não coincidem';
    }
    const phone = parsePhone(body.phone);
    if (phone.error) errors.phone = phone.error;
    else if (!phone.value) errors.phone = 'Informe o telefone WhatsApp';
    else data.phone = phone.value;
    if (Object.keys(errors).length) return validationError(res, errors);

    // Robô: finge que deu certo, sem criar nada (o ticket falso não confirma nada)
    if (typeof body[HONEYPOT_FIELD] === 'string' && body[HONEYPOT_FIELD].trim()) {
      return res.status(201).json({
        ticket: crypto.randomBytes(32).toString('base64url'),
        phone: maskPhone(data.phone),
        resendIn: 60,
        mode,
      });
    }

    let user;
    try {
      user = await prisma.user.create({
        data: {
          name: data.name,
          username: data.username,
          phone: data.phone,
          passwordHash: await hashPassword(data.password),
          isMaster: false, // nunca master, não importa o que venha no corpo
          status: 'pendente',
          createdBy: 'cadastro',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res
          .status(409)
          .json({ error: USERNAME_IN_USE, fields: { username: USERNAME_IN_USE } });
      }
      throw err;
    }

    const sent = await sendVerificationCode(user, send);
    res.status(201).json({
      ticket: createTicket(user),
      phone: maskPhone(user.phone),
      resendIn: sent.resendIn ?? sent.retryAfter,
      mode,
    });
  });

  router.post('/resend-code', ...codeSendLimiters, async (req, res) => {
    const user = await userFromTicket(req.body?.ticket);
    if (!user) return res.status(400).json({ error: TICKET_INVALID, code: 'ticket_invalid' });
    const result = await sendVerificationCode(user, send);
    if (result.retryAfter) {
      return res.status(429).json({
        error: 'Aguarde para pedir outro código.',
        retryAfter: result.retryAfter,
      });
    }
    res.json({ phone: maskPhone(user.phone), ...result });
  });

  router.post('/verify-phone', codeCheckLimiter, async (req, res) => {
    const user = await userFromTicket(req.body?.ticket);
    if (!user) return res.status(400).json({ error: TICKET_INVALID, code: 'ticket_invalid' });

    const result = await checkVerificationCode(user, req.body?.code);
    if (!result.ok) return sendCodeError(res, result);

    // Modo aberto: conta liberada agora. O master também pode ter aprovado antes.
    let status = user.status;
    if (status === 'pendente' && signupMode() === 'aberto') {
      await prisma.user.update({ where: { id: user.id }, data: { status: 'ativo' } });
      status = 'ativo';
    }

    if (status === 'ativo') {
      const fresh = await prisma.user.findUnique({
        where: { id: user.id },
        select: { ...publicUserSelect, sessionVersion: true },
      });
      const { sessionVersion, ...publicUser } = fresh;
      setSessionCookie(res, { id: fresh.id, sessionVersion }, { remember: true });
      return res.json({ status, user: publicUser });
    }

    await notifyMasters(user, send);
    res.json({ status });
  });

  return router;
}
