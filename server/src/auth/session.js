// Sessão de login: JWT assinado com JWT_SECRET, guardado em cookie httpOnly.
import jwt from 'jsonwebtoken';

export const COOKIE_NAME = 'goals_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET não definido em server/.env');
  return value;
}

/** Garante que o JWT_SECRET existe antes de o servidor subir. */
export function assertAuthConfig() {
  secret();
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

export function setSessionCookie(res, user) {
  const token = jwt.sign({ sub: String(user.id) }, secret(), {
    algorithm: 'HS256',
    expiresIn: Math.floor(MAX_AGE_MS / 1000),
  });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: MAX_AGE_MS });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/** Retorna o id do usuário do token, ou null se ausente/inválido/expirado. */
export function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}
