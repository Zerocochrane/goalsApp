import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../db/prisma.js';
import { publicUserSelect, requireAuth } from './middleware.js';
import { burnPasswordCheck, verifyPassword } from './password.js';
import { clearSessionCookie, setSessionCookie } from './session.js';

// 5 tentativas por minuto por IP (logins certos não contam)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde um minuto e tente novamente.' },
});

const INVALID = 'Usuário ou senha inválidos';

const toPublicUser = (user) =>
  Object.fromEntries(Object.keys(publicUserSelect).map((key) => [key, user[key]]));

export function authRouter() {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body ?? {};
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username.trim() ||
      !password
    ) {
      return res.status(400).json({ error: 'Informe usuário e senha' });
    }

    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : await burnPasswordCheck(password);
    if (!ok) return res.status(401).json({ error: INVALID });

    setSessionCookie(res, user);
    res.json({ user: toPublicUser(user) });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
