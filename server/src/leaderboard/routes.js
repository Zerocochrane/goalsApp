// GET /api/leaderboard?periodo=semana|mes|sequencia
//   → [{ posicao, usuario: { id, nome, username }, percentual, diasConcluidos, concluidas,
//        total, sequencia, melhorSequencia, voce }]
//
// Participam o usuário logado e os amigos com amizade aceita (até MAX_FRIENDS).
// Privacidade: de outro usuário só saem números agregados — nunca nomes ou horários das
// atividades. As ocorrências não são carregadas uma a uma: o banco devolve uma linha por
// usuário e dia (contagens), e só as pendentes (poucas, o agendador as expira em 1h) vêm
// individualmente.
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { todayInSaoPaulo } from '../activities/recurrence.js';
import {
  PERIODS,
  percentOf,
  periodMetrics,
  periodRange,
  rankEntries,
  streaks,
  summarizeDays,
} from './leaderboard.js';

/** Máximo de amigos considerados no ranking (os mais antigos primeiro). */
export const MAX_FRIENDS = 100;

/** Ids dos amigos aceitos do usuário (no máximo MAX_FRIENDS). */
async function acceptedFriendIds(userId) {
  const rows = await prisma.friendship.findMany({
    where: { status: 'aceita', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
    orderBy: { id: 'asc' },
    take: MAX_FRIENDS,
  });
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

/** Uma linha por usuário e dia: concluídas, falhas e ids das atividades com ocorrência. */
function occurrenceDaysFor(userIds, today) {
  return prisma.$queryRaw`
    SELECT "userId", "date",
      SUM(CASE WHEN "status" = 'concluida' THEN 1 ELSE 0 END) AS "concluidas",
      SUM(CASE WHEN "status" = 'falhou' THEN 1 ELSE 0 END) AS "falhas",
      group_concat("activityId") AS "ids"
    FROM "TaskOccurrence"
    WHERE "userId" IN (${Prisma.join(userIds)}) AND "date" <= ${today}
    GROUP BY "userId", "date"`;
}

/**
 * Progresso agregado de cada usuário: resumo diário de todo o histórico até hoje.
 * Devolve Map(userId → dias), no formato de `summarizeDays`.
 */
export async function dailySummaries(userIds, now = new Date()) {
  const today = todayInSaoPaulo(now);
  const [activities, occurrenceRows, pending] = await Promise.all([
    // Todas as versões (inclusive encerradas): o histórico usa a versão que valia no dia
    prisma.activity.findMany({
      where: { userId: { in: userIds }, startDate: { lte: today } },
      select: { id: true, userId: true, weekdays: true, startDate: true, endDate: true },
    }),
    occurrenceDaysFor(userIds, today),
    prisma.taskOccurrence.findMany({
      where: {
        userId: { in: userIds },
        status: 'pendente',
        date: { lte: today },
        expiresAt: { gt: now },
      },
      select: { activityId: true, date: true },
    }),
  ]);

  const openPending = new Set(pending.map((o) => `${o.activityId}|${o.date}`));
  const result = new Map();
  for (const userId of userIds) {
    const own = activities.filter((a) => a.userId === userId);
    const occurrenceDays = occurrenceRows
      .filter((row) => Number(row.userId) === userId)
      .map((row) => ({
        date: row.date,
        concluidas: Number(row.concluidas),
        falhas: Number(row.falhas),
        activityIds: String(row.ids ?? '')
          .split(',')
          .filter(Boolean)
          .map(Number),
      }));
    const dates = [...own.map((a) => a.startDate), ...occurrenceDays.map((d) => d.date)];
    const start = dates.length ? dates.reduce((min, d) => (d < min ? d : min)) : null;
    result.set(
      userId,
      summarizeDays({ activities: own, occurrenceDays, openPending, start, today }),
    );
  }
  return result;
}

/** Ranking do usuário e seus amigos no período. */
export async function buildLeaderboard(userId, periodo, now = new Date()) {
  const ids = [userId, ...(await acceptedFriendIds(userId))];
  const [users, summaries] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, username: true },
    }),
    dailySummaries(ids, now),
  ]);

  const today = todayInSaoPaulo(now);
  const range = periodRange(periodo, today);
  const entries = users.map((user) => {
    const days = summaries.get(user.id) ?? [];
    const { atual, melhor } = streaks(days);
    const metrics =
      periodo === 'sequencia'
        ? periodMetrics(days, { inicio: '0000-01-01', fim: today })
        : periodMetrics(days, range);
    return {
      usuario: { id: user.id, nome: user.name, username: user.username },
      percentual: percentOf(metrics.concluidas, metrics.total),
      diasConcluidos: metrics.diasConcluidos,
      concluidas: metrics.concluidas,
      total: metrics.total,
      sequencia: atual,
      melhorSequencia: melhor,
      voce: user.id === userId,
      temHistorico: days.length > 0,
    };
  });

  return rankEntries(periodo, entries).map(({ temHistorico: _, ...entry }) => entry);
}

export function leaderboardRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    const periodo = req.query.periodo ?? 'semana';
    if (!PERIODS.includes(periodo)) {
      return res.status(400).json({ error: 'Período inválido. Use semana, mes ou sequencia.' });
    }
    res.json(await buildLeaderboard(req.user.id, periodo));
  });

  return router;
}
