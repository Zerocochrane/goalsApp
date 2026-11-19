// Confirmação do telefone por código de 6 dígitos enviado pelo WhatsApp.
//
// - Só o hash do código fica no banco (HMAC-SHA256 com o JWT_SECRET).
// - O código vale 10 minutos e aceita até 5 tentativas; depois disso, só um código novo.
// - Um envio por minuto por usuário (além do limite por IP nas rotas).
// - O código vale só para o número para o qual foi enviado: se o telefone mudar, não confirma.
import crypto from 'node:crypto';
import { prisma } from '../db/prisma.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_INTERVAL_MS = 60 * 1000;

export const INVALID_CODE = 'Código inválido ou expirado';
export const TOO_MANY_ATTEMPTS = 'Muitas tentativas erradas. Peça um novo código.';

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET não definido em server/.env');
  return value;
}

/** Hash do código, amarrado ao usuário (o mesmo código de outro usuário não confere). */
export function hashCode(userId, code) {
  return crypto
    .createHmac('sha256', `${secret()}:phone-code`)
    .update(`${userId}:${code}`)
    .digest('hex');
}

export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Texto enviado pelo WhatsApp. */
export function codeMessage(code) {
  return `Seu código de confirmação do Goals é *${code}*. Ele vale por 10 minutos. Não compartilhe com ninguém.`;
}

/** +5532999998888 → +55 (32) 9****-8888 (mostrado na tela do código). */
export function maskPhone(phone) {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phone || '');
  if (!match) return '';
  const [, ddd, first, last] = match;
  return `+55 (${ddd}) ${first[0]}${'*'.repeat(first.length - 1)}-${last}`;
}

/** Segundos até poder pedir outro código (0 = já pode). */
export function secondsUntilResend(verification, now = Date.now()) {
  if (!verification) return 0;
  const wait = verification.createdAt.getTime() + RESEND_INTERVAL_MS - now;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/**
 * Gera um código novo para `user` (substitui o anterior) e envia pelo WhatsApp.
 * Devolve `{ retryAfter }` se ainda não pode reenviar, ou `{ resendIn, expiresIn }`.
 * O envio não é aguardado: a fila do WhatsApp pode demorar e uma falha só vai para o log.
 */
export async function sendVerificationCode(user, send, { now = Date.now() } = {}) {
  const current = await prisma.phoneVerification.findUnique({ where: { userId: user.id } });
  const retryAfter = secondsUntilResend(current, now);
  if (retryAfter > 0) return { retryAfter };

  const code = generateCode();
  const data = {
    phone: user.phone,
    codeHash: hashCode(user.id, code),
    expiresAt: new Date(now + CODE_TTL_MS),
    attempts: 0,
    createdAt: new Date(now),
  };
  await prisma.phoneVerification.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  Promise.resolve()
    .then(() => send(user.phone, codeMessage(code)))
    .catch((err) =>
      console.error(`[cadastro] falha ao enviar código para o usuário ${user.id}:`, err.message),
    );

  return { resendIn: RESEND_INTERVAL_MS / 1000, expiresIn: CODE_TTL_MS / 1000 };
}

function sameHash(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Confere o código digitado. Em caso de acerto, marca o telefone como confirmado e apaga
 * o código. Devolve `{ ok: true }` ou `{ error, status, attemptsLeft? }`.
 */
export async function checkVerificationCode(user, rawCode, { now = Date.now() } = {}) {
  const code = typeof rawCode === 'string' ? rawCode.replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(code)) {
    return { status: 400, error: 'Informe o código de 6 dígitos' };
  }

  const verification = await prisma.phoneVerification.findUnique({ where: { userId: user.id } });
  if (
    !verification ||
    verification.expiresAt.getTime() <= now ||
    verification.phone !== user.phone
  ) {
    return { status: 400, error: INVALID_CODE };
  }
  if (verification.attempts >= MAX_ATTEMPTS) {
    return { status: 429, error: TOO_MANY_ATTEMPTS, attemptsLeft: 0 };
  }

  if (!sameHash(verification.codeHash, hashCode(user.id, code))) {
    // updateMany com o limite na condição: tentativas simultâneas não passam de 5
    await prisma.phoneVerification.updateMany({
      where: { id: verification.id, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - verification.attempts - 1);
    return attemptsLeft === 0
      ? { status: 429, error: TOO_MANY_ATTEMPTS, attemptsLeft }
      : { status: 400, error: INVALID_CODE, attemptsLeft };
  }

  // O código só vale uma vez: apagar antes de confirmar evita uso duplo simultâneo
  const { count } = await prisma.phoneVerification.deleteMany({
    where: { id: verification.id, codeHash: verification.codeHash },
  });
  if (count === 0) return { status: 400, error: INVALID_CODE };
  await prisma.user.update({
    where: { id: user.id },
    data: { phoneVerifiedAt: new Date(now) },
  });
  return { ok: true };
}

/** Resposta padrão de erro de código. */
export function sendCodeError(res, result) {
  const body = { error: result.error, fields: { code: result.error } };
  if (result.attemptsLeft !== undefined) body.attemptsLeft = result.attemptsLeft;
  return res.status(result.status).json(body);
}
