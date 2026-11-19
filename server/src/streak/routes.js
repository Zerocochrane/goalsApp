// GET  /api/streak            → { atual, ultimoMarcoComemorado, marcoPendente }
// POST /api/streak/celebrate  → marca o marco atual como comemorado (só uma vez por marco)
import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { buildCalendar, todayInSaoPaulo } from '../activities/recurrence.js';
import { computeStreak, milestoneFor, pendingMilestone } from './streak.js';

/** Sequência atual do usuário, calculada sobre todo o histórico até hoje. */
export async function currentStreak(userId, now = new Date()) {
  return (await progressSummary(userId, now)).atual;
}

/**
 * Progresso agregado do usuário (o que amigos podem ver): sequência atual e total de
 * dias concluídos. Nada de atividades, horários ou telefone.
 */
export async function progressSummary(userId, now = new Date()) {
  const today = todayInSaoPaulo(now);
  const [activities, occurrences] = await Promise.all([
    prisma.activity.findMany({
      where: { userId, startDate: { lte: today } },
      select: {
        id: true,
        name: true,
        hour: true,
        minute: true,
        weekdays: true,
        startDate: true,
        endDate: true,
        active: true,
      },
    }),
    prisma.taskOccurrence.findMany({
      where: { userId, date: { lte: today } },
      select: {
        id: true,
        activityId: true,
        date: true,
        status: true,
        scheduledAt: true,
        expiresAt: true,
        notifiedAt: true,
        completedAt: true,
        activity: { select: { name: true, hour: true, minute: true } },
      },
    }),
  ]);

  const dates = [...activities.map((a) => a.startDate), ...occurrences.map((o) => o.date)];
  if (dates.length === 0) return { atual: 0, diasConcluidos: 0 };
  const start = dates.reduce((min, date) => (date < min ? date : min));

  const days = buildCalendar({ activities, occurrences, start, end: today, today });
  return {
    atual: computeStreak(days, { today, now }),
    diasConcluidos: days.filter((day) => day.status === 'concluido').length,
  };
}

export function streakRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    const [atual, user] = await Promise.all([
      currentStreak(req.user.id),
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { lastCelebratedStreak: true },
      }),
    ]);
    const ultimoMarcoComemorado = user?.lastCelebratedStreak ?? 0;
    res.json({
      atual,
      ultimoMarcoComemorado,
      marcoPendente: pendingMilestone(atual, ultimoMarcoComemorado),
    });
  });

  router.post('/celebrate', async (req, res) => {
    const atual = await currentStreak(req.user.id);
    const marco = milestoneFor(atual);
    // Só avança: nunca reduz o último marco comemorado
    await prisma.user.updateMany({
      where: { id: req.user.id, lastCelebratedStreak: { lt: marco } },
      data: { lastCelebratedStreak: marco },
    });
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { lastCelebratedStreak: true },
    });
    const ultimoMarcoComemorado = user?.lastCelebratedStreak ?? 0;
    res.json({
      atual,
      ultimoMarcoComemorado,
      marcoPendente: pendingMilestone(atual, ultimoMarcoComemorado),
    });
  });

  return router;
}
