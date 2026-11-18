import { prisma } from '../db/prisma.js';
import { clearSessionCookie, readSession } from './session.js';

/** Campos do usuário que podem ir para o cliente (nunca o passwordHash). */
export const publicUserSelect = {
  id: true,
  username: true,
  name: true,
  phone: true,
  isMaster: true,
  createdAt: true,
};

/** Exige sessão válida; coloca o usuário em req.user. */
export async function requireAuth(req, res, next) {
  const userId = readSession(req);
  const user =
    userId && (await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect }));
  if (!user) {
    if (userId) clearSessionCookie(res); // usuário removido: limpa o cookie
    return res.status(401).json({ error: 'Não autenticado' });
  }
  req.user = user;
  next();
}

/** Exige que o usuário logado seja o admin master (use depois de requireAuth). */
export function requireMaster(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (!req.user.isMaster)
    return res.status(403).json({ error: 'Acesso restrito ao administrador' });
  next();
}
