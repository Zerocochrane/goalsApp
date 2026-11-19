import { prisma } from '../db/prisma.js';
import { clearSessionCookie, readSession } from './session.js';

/** Campos do usuário que podem ir para o cliente (nunca o passwordHash). */
export const publicUserSelect = {
  id: true,
  username: true,
  name: true,
  phone: true,
  isMaster: true,
  status: true,
  phoneVerifiedAt: true,
  createdBy: true,
  createdAt: true,
};

export const PENDING_APPROVAL = 'Sua conta aguarda aprovação do administrador.';
export const PHONE_UNVERIFIED = 'Confirme seu telefone para continuar.';

/**
 * Exige sessão válida; coloca o usuário em req.user. A sessão cai se o usuário foi
 * removido ou se a senha mudou depois do login (versão da sessão diferente).
 * Conta pendente (cadastro aguardando aprovação) recebe 403.
 */
export async function requireAuth(req, res, next) {
  const session = readSession(req);
  const found =
    session &&
    (await prisma.user.findUnique({
      where: { id: session.userId },
      select: { ...publicUserSelect, sessionVersion: true },
    }));
  if (!found || found.sessionVersion !== session.version) {
    if (session) clearSessionCookie(res); // cookie que não vale mais: limpa
    return res.status(401).json({ error: 'Não autenticado' });
  }
  // Conta ainda não aprovada (cadastro): não usa a API
  if (found.status !== 'ativo') {
    clearSessionCookie(res);
    return res.status(403).json({ error: PENDING_APPROVAL, code: 'pending_approval' });
  }
  const { sessionVersion: _version, ...user } = found;
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
