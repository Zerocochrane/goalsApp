// Sessão de login: JWT assinado com JWT_SECRET, guardado em cookie httpOnly.
import jwt from 'jsonwebtoken';

export const COOKIE_NAME = 'goals_session';
const DAY_MS = 24 * 60 * 60 * 1000;
// "Manter conectado" (padrão): cookie persistente de 30 dias, renovado ao abrir o app
// (ver refreshSessionCookie). O link do WhatsApp abre num navegador interno que não
// compartilha cookies com o Chrome/Safari; sessão longa evita login a cada link.
export const REMEMBER_MAX_AGE_MS = 30 * DAY_MS;
// Sem "Manter conectado": cookie de sessão do navegador e JWT de 12 horas.
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
// Renova o cookie lembrado quando ele tem mais de 1 dia
const REFRESH_AFTER_MS = DAY_MS;

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET não definido em server/.env');
  return value;
}

/** Garante que o JWT_SECRET existe antes de o servidor subir. */
export function assertAuthConfig() {
  if (secret().length < 32) {
    console.warn('JWT_SECRET curto: use um texto aleatório com pelo menos 32 caracteres.');
  }
}

function isSecureCookie() {
  const forced = process.env.COOKIE_SECURE;
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  return (process.env.APP_URL || '').startsWith('https://');
}

function cookieOptions() {
  return {
    httpOnly: true,
    // Cookie "secure" só funciona em HTTPS. Padrão: segue o APP_URL (https:// → secure).
    // COOKIE_SECURE=true|false em server/.env força o valor.
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * Grava o cookie de login. `v` é a versão da sessão do usuário: quando a senha muda,
 * a versão sobe e os cookies emitidos antes deixam de valer (ver requireAuth).
 * `r` marca a sessão "Manter conectado" (cookie persistente, renovável).
 */
export function setSessionCookie(res, user, { remember = true } = {}) {
  const lifetime = remember ? REMEMBER_MAX_AGE_MS : SHORT_SESSION_MS;
  const payload = { sub: String(user.id), v: user.sessionVersion ?? 0 };
  if (remember) payload.r = 1;
  const token = jwt.sign(payload, secret(), {
    algorithm: 'HS256',
    expiresIn: Math.floor(lifetime / 1000),
  });
  // Sem maxAge o cookie some ao fechar o navegador
  res.cookie(
    COOKIE_NAME,
    token,
    remember ? { ...cookieOptions(), maxAge: lifetime } : cookieOptions(),
  );
}

/**
 * Sessão "Manter conectado" emitida há mais de 1 dia: emite um cookie novo de 30 dias,
 * para quem usa o app não cair a cada 30 dias. `session` vem de readSession.
 */
export function refreshSessionCookie(res, session, user, now = Date.now()) {
  if (!session?.remember || !session.issuedAt) return;
  if (now - session.issuedAt * 1000 < REFRESH_AFTER_MS) return;
  setSessionCookie(res, { id: user.id, sessionVersion: session.version }, { remember: true });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/**
 * Retorna `{ userId, version, remember, issuedAt }` do token, ou null se ausente/inválido/expirado.
 * Tokens anteriores à versão de sessão (sem `v`) valem como versão 0.
 */
export function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    const userId = Number(payload.sub);
    const version = payload.v ?? 0;
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isInteger(version)) return null;
    return { userId, version, remember: payload.r === 1, issuedAt: payload.iat };
  } catch {
    return null;
  }
}
