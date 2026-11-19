// Lista de amigos (issue #28). Amizade é mútua: um usuário envia o pedido e o outro aceita.
//
// GET    /api/friends                        → { amigos, recebidos, enviados }
// GET    /api/friends/pending                → { recebidos } (contador da aba)
// POST   /api/friends/requests { username }  → envia pedido
// POST   /api/friends/requests/:id/accept    → aceita (só quem recebeu)
// POST   /api/friends/requests/:id/decline   → recusa (só quem recebeu)
// DELETE /api/friends/requests/:id           → cancela (só quem enviou)
// DELETE /api/friends/:userId                → desfaz a amizade (qualquer um dos dois)
//
// Privacidade: de outro usuário só saem nome, @usuário e progresso agregado (sequência e
// dias concluídos). Atividades, horários e telefone nunca.
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { progressSummary } from '../streak/routes.js';
import { parseUsername } from '../users/validation.js';

/** Campos de outro usuário que podem ir para o cliente. */
const friendUserSelect = { id: true, name: true, username: true };

const REQUEST_NOT_FOUND = 'Pedido de amizade não encontrado';

/** Chave do par de usuários, igual nos dois sentidos (A→B e B→A). */
export function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Pedidos de amizade: 20 por 10 minutos por usuário (evita varrer nomes de usuário)
const requestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitos pedidos de amizade. Aguarde alguns minutos e tente novamente.' },
});

/** Pedido pendente com o id dado em que o usuário logado tem o papel `role`. */
function findPendingRequest(id, userId, role) {
  return prisma.friendship.findFirst({
    where: { id, status: 'pendente', [role]: userId },
  });
}

export function friendsRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    const me = req.user.id;
    const rows = await prisma.friendship.findMany({
      where: { OR: [{ requesterId: me }, { addresseeId: me }] },
      select: {
        id: true,
        status: true,
        createdAt: true,
        respondedAt: true,
        requesterId: true,
        requester: { select: friendUserSelect },
        addressee: { select: friendUserSelect },
      },
      orderBy: { createdAt: 'desc' },
    });

    const recebidos = [];
    const enviados = [];
    const accepted = [];
    for (const row of rows) {
      const sentByMe = row.requesterId === me;
      const other = sentByMe ? row.addressee : row.requester;
      if (row.status === 'aceita') {
        accepted.push({ user: other, since: row.respondedAt ?? row.createdAt });
      } else {
        (sentByMe ? enviados : recebidos).push({
          id: row.id,
          user: other,
          createdAt: row.createdAt,
        });
      }
    }

    const amigos = await Promise.all(
      accepted.map(async ({ user, since }) => ({
        ...user,
        amigosDesde: since,
        ...(await progressSummary(user.id)),
      })),
    );
    amigos.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    res.json({ amigos, recebidos, enviados });
  });

  router.get('/pending', async (req, res) => {
    const recebidos = await prisma.friendship.count({
      where: { addresseeId: req.user.id, status: 'pendente' },
    });
    res.json({ recebidos });
  });

  router.post('/requests', requestLimiter, async (req, res) => {
    const raw =
      typeof req.body?.username === 'string' ? req.body.username.replace(/^\s*@/, '') : '';
    const parsed = parseUsername(raw);
    if (parsed.error) {
      const error = raw.trim() ? 'Usuário não encontrado' : 'Informe o @usuário do seu amigo';
      return res.status(raw.trim() ? 404 : 400).json({ error, fields: { username: error } });
    }

    const me = req.user.id;
    // Conta aguardando aprovação ainda não existe para os outros usuários
    const target = await prisma.user.findFirst({
      where: { username: parsed.value, status: 'ativo' },
      select: friendUserSelect,
    });
    if (!target) {
      const error = 'Usuário não encontrado';
      return res.status(404).json({ error, fields: { username: error } });
    }
    if (target.id === me) {
      const error = 'Você não pode adicionar a si mesmo';
      return res.status(400).json({ error, fields: { username: error } });
    }

    const key = pairKey(me, target.id);
    const existing = await prisma.friendship.findUnique({ where: { pairKey: key } });
    if (existing) return res.status(409).json(conflictFor(existing, me, target));

    try {
      const created = await prisma.friendship.create({
        data: { requesterId: me, addresseeId: target.id, pairKey: key },
        select: { id: true, createdAt: true },
      });
      res.status(201).json({ pedido: { ...created, user: target } });
    } catch (err) {
      // Dois pedidos simultâneos para o mesmo par: o segundo vira conflito
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await prisma.friendship.findUnique({ where: { pairKey: key } });
        if (again) return res.status(409).json(conflictFor(again, me, target));
      }
      throw err;
    }
  });

  router.post('/requests/:id/accept', async (req, res) => {
    const id = parseId(req.params.id);
    const request = id && (await findPendingRequest(id, req.user.id, 'addresseeId'));
    if (!request) return res.status(404).json({ error: REQUEST_NOT_FOUND });

    // updateMany com status pendente: se o outro cancelou no meio do caminho, não aceita
    const { count } = await prisma.friendship.updateMany({
      where: { id, status: 'pendente' },
      data: { status: 'aceita', respondedAt: new Date() },
    });
    if (count === 0) return res.status(404).json({ error: REQUEST_NOT_FOUND });
    const friend = await prisma.user.findUnique({
      where: { id: request.requesterId },
      select: friendUserSelect,
    });
    res.json({ amigo: friend });
  });

  router.post('/requests/:id/decline', async (req, res) => {
    const id = parseId(req.params.id);
    const request = id && (await findPendingRequest(id, req.user.id, 'addresseeId'));
    if (!request) return res.status(404).json({ error: REQUEST_NOT_FOUND });
    await prisma.friendship.deleteMany({ where: { id, status: 'pendente' } });
    res.status(204).end();
  });

  router.delete('/requests/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const request = id && (await findPendingRequest(id, req.user.id, 'requesterId'));
    if (!request) return res.status(404).json({ error: REQUEST_NOT_FOUND });
    await prisma.friendship.deleteMany({ where: { id, status: 'pendente' } });
    res.status(204).end();
  });

  router.delete('/:userId', async (req, res) => {
    const other = parseId(req.params.userId);
    const { count } = other
      ? await prisma.friendship.deleteMany({
          where: { pairKey: pairKey(req.user.id, other), status: 'aceita' },
        })
      : { count: 0 };
    if (count === 0) return res.status(404).json({ error: 'Amizade não encontrada' });
    res.status(204).end();
  });

  return router;
}

/** Corpo do 409 quando já existe pedido ou amizade entre os dois. */
function conflictFor(existing, me, target) {
  let error;
  if (existing.status === 'aceita') error = 'Vocês já são amigos';
  else if (existing.requesterId === me) error = `Você já enviou um pedido para @${target.username}`;
  else error = `@${target.username} já te enviou um pedido. Aceite-o em Pedidos recebidos.`;
  return { error, fields: { username: error } };
}
