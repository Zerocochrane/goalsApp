// GET /api/calendar?start=AAAA-MM-DD&end=AAAA-MM-DD
// Para cada dia: atividades previstas pela recorrência + ocorrências reais com status
// + status do dia. Só dados do usuário logado.
import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { buildCalendar, daysBetween, isValidDate, todayInSaoPaulo } from './recurrence.js';

export const CALENDAR_MAX_DAYS = 93;

export function calendarRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    const { start, end } = req.query;
    if (!isValidDate(start) || !isValidDate(end)) {
      return res.status(400).json({ error: 'Informe start e end no formato AAAA-MM-DD' });
    }
    if (end < start) {
      return res.status(400).json({ error: 'A data final deve ser igual ou posterior à inicial' });
    }
    if (daysBetween(start, end) + 1 > CALENDAR_MAX_DAYS) {
      return res
        .status(400)
        .json({ error: `O período pode ter no máximo ${CALENDAR_MAX_DAYS} dias` });
    }

    const userId = req.user.id;
    const [activities, occurrences] = await Promise.all([
      // Inclui versões encerradas (editadas/excluídas) que ainda valiam no período
      prisma.activity.findMany({
        where: {
          userId,
          startDate: { lte: end },
          OR: [{ endDate: null }, { endDate: { gte: start } }],
        },
        select: {
          id: true,
          name: true,
          hour: true,
          minute: true,
          weekdays: true,
          startDate: true,
          endDate: true,
        },
      }),
      prisma.taskOccurrence.findMany({
        where: { userId, date: { gte: start, lte: end } },
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

    const today = todayInSaoPaulo();
    res.json({
      start,
      end,
      today,
      days: buildCalendar({ activities, occurrences, start, end, today }),
    });
  });

  return router;
}
