// Comemoração do dia concluído (confete): quando todas as atividades de HOJE (fuso de
// São Paulo) estão concluídas e o usuário ainda não viu o confete hoje.
//
// GET  /api/streak e POST /api/occurrences/validate/:token → `diaConcluidoParaComemorar`
// POST /api/day/celebrate → marca hoje como comemorado (só se hoje estiver concluído)
import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { buildCalendar, todayInSaoPaulo } from '../activities/recurrence.js';

/** Status de hoje para o usuário ('vazio' | 'pendente' | 'concluido' | 'falhou'). */
export async function todayStatus(userId, today) {
  const [activities, occurrences] = await Promise.all([
    prisma.activity.findMany({
      where: {
        userId,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
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
      where: { userId, date: today },
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
  const [day] = buildCalendar({ activities, occurrences, start: today, end: today, today });
  return day.status;
}

/** true se hoje está concluído e o confete de hoje ainda não foi mostrado. */
export async function dayCelebrationPending(userId, now = new Date()) {
  const today = todayInSaoPaulo(now);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastDayCelebrated: true },
  });
  if (!user || user.lastDayCelebrated === today) return false;
  return (await todayStatus(userId, today)) === 'concluido';
}

/** Marca hoje como comemorado, se hoje estiver concluído. Retorna se marcou. */
export async function celebrateDay(userId, now = new Date()) {
  const today = todayInSaoPaulo(now);
  if ((await todayStatus(userId, today)) !== 'concluido') return false;
  await prisma.user.update({ where: { id: userId }, data: { lastDayCelebrated: today } });
  return true;
}

export function dayRouter() {
  const router = Router();

  router.post('/celebrate', async (req, res) => {
    const comemorado = await celebrateDay(req.user.id);
    res.json({ comemorado, diaConcluidoParaComemorar: false });
  });

  return router;
}
