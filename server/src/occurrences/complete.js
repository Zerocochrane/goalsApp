// Conclusão de uma atividade de HOJE pelo próprio site (POST /api/activities/:id/complete).
//
// Mesmas regras do link do WhatsApp (validate.js), sempre com o relógio do servidor:
//  - só o dono, só a ocorrência de hoje (fuso America/Sao_Paulo), uma única vez;
//  - não antes do horário (`scheduledAt`) e só até `expiresAt` (1 hora depois);
//  - depois do prazo a ocorrência fica `falhou` e não conclui mais.
// Se o agendador ainda não criou a ocorrência (atraso ou reinício), ela é criada aqui
// com as mesmas regras; o índice único (activityId, date) impede duplicar.
import {
  formatTime,
  occursOn,
  todayInSaoPaulo,
  zonedDateTime,
  TIME_ZONE,
} from '../activities/recurrence.js';
import { VALIDATION_WINDOW_MS, effectiveFrom, generateToken } from '../scheduler/scheduler.js';
import { VALIDATION_MESSAGES } from './validate.js';

const NOT_FOUND = 'Atividade não encontrada para hoje.';

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "07:30" no horário de São Paulo. */
export function formatClock(instant) {
  return timeFormatter.format(instant);
}

export const COMPLETE_MESSAGES = {
  concluida: 'Atividade concluída!',
  antes_do_horario: (time) => `Esta atividade só pode ser concluída a partir das ${time}.`,
  prazo_encerrado: (time) => `O prazo para concluir esta atividade terminou às ${time}.`,
  ja_validado: VALIDATION_MESSAGES.ja_validado,
  nao_encontrada: NOT_FOUND,
};

/**
 * Janela de conclusão de uma atividade em `date`:
 * `{ availableFrom, deadline, eligible }`. Com ocorrência, vale a dela; sem ocorrência,
 * a prevista pelo horário — e só se a versão já valia no horário (como no agendador:
 * atividade criada às 10h com horário 7h não tem a ocorrência das 7h daquele dia).
 */
export function completionWindow({ activity, occurrence, date }) {
  if (occurrence) {
    return {
      availableFrom: new Date(occurrence.scheduledAt),
      deadline: new Date(occurrence.expiresAt),
      eligible: occurrence.status === 'pendente',
    };
  }
  const availableFrom = zonedDateTime(date, activity.hour, activity.minute);
  return {
    availableFrom,
    deadline: new Date(availableFrom.getTime() + VALIDATION_WINDOW_MS),
    eligible: availableFrom >= effectiveFrom(activity),
  };
}

/**
 * Campos de conclusão de um item do calendário de hoje:
 * `{ podeConcluir, disponivelEm, prazoAte }` (instantes ISO; null quando não se aplica).
 */
export function completionFields({ activity, occurrence, date, now }) {
  const status = occurrence?.status ?? 'pendente';
  const window = activity || occurrence ? completionWindow({ activity, occurrence, date }) : null;
  if (!window?.eligible || status !== 'pendente' || now >= window.deadline) {
    return { podeConcluir: false, disponivelEm: null, prazoAte: null };
  }
  return {
    podeConcluir: now >= window.availableFrom,
    disponivelEm: window.availableFrom.toISOString(),
    prazoAte: window.deadline.toISOString(),
  };
}

function result(code, httpStatus, message, occurrence) {
  return {
    code,
    httpStatus,
    message,
    occurrence: occurrence
      ? {
          id: occurrence.id,
          activityId: occurrence.activityId,
          activityName: occurrence.activity?.name ?? null,
          date: occurrence.date,
          scheduledAt: occurrence.scheduledAt,
          expiresAt: occurrence.expiresAt,
          completedAt: occurrence.completedAt,
          status: occurrence.status,
        }
      : null,
  };
}

const notFound = () => result('nao_encontrada', 404, NOT_FOUND);
const include = { activity: { select: { name: true } } };

/** Cria a ocorrência de hoje que o agendador ainda não criou (ou devolve a existente). */
async function ensureOccurrence(prisma, activity, date, now) {
  const window = completionWindow({ activity, occurrence: null, date });
  try {
    return await prisma.taskOccurrence.create({
      data: {
        activityId: activity.id,
        userId: activity.userId,
        date,
        scheduledAt: window.availableFrom,
        expiresAt: window.deadline,
        status: window.deadline > now ? 'pendente' : 'falhou',
        token: generateToken(),
      },
      include,
    });
  } catch (err) {
    // Índice único (activityId, date): o agendador (ou outro clique) criou antes
    if (err?.code !== 'P2002') throw err;
    return prisma.taskOccurrence.findUnique({
      where: { activityId_date: { activityId: activity.id, date } },
      include,
    });
  }
}

/**
 * Conclui a atividade `activityId` de hoje para `userId` no instante `now`.
 * Retorna `{ code, httpStatus, message, occurrence }`.
 */
export async function completeActivity({ prisma, activityId, userId, now = new Date() }) {
  if (!Number.isSafeInteger(activityId) || activityId <= 0) return notFound();
  const today = todayInSaoPaulo(now);

  // Qualquer versão (também uma encerrada hoje, cuja ocorrência de hoje continua valendo);
  // de outro usuário responde igual a inexistente
  const activity = await prisma.activity.findFirst({ where: { id: activityId, userId } });
  if (!activity) return notFound();

  let occurrence = await prisma.taskOccurrence.findUnique({
    where: { activityId_date: { activityId, date: today } },
    include,
  });

  if (!occurrence) {
    if (!occursOn(activity, today)) return notFound();
    const window = completionWindow({ activity, occurrence: null, date: today });
    if (!window.eligible) return notFound();
    if (now < window.availableFrom) {
      const time = formatTime(activity.hour, activity.minute);
      return result('antes_do_horario', 409, COMPLETE_MESSAGES.antes_do_horario(time));
    }
    occurrence = await ensureOccurrence(prisma, activity, today, now);
    if (!occurrence) return notFound();
  }

  if (occurrence.status === 'concluida') {
    return result('ja_validado', 409, COMPLETE_MESSAGES.ja_validado, occurrence);
  }
  if (now < occurrence.scheduledAt) {
    const time = formatClock(occurrence.scheduledAt);
    return result('antes_do_horario', 409, COMPLETE_MESSAGES.antes_do_horario(time), occurrence);
  }

  // UPDATE condicional: nem o agendador nem um segundo clique (ou o link) concluem junto
  const { count } = await prisma.taskOccurrence.updateMany({
    where: {
      id: occurrence.id,
      status: 'pendente',
      scheduledAt: { lte: now },
      expiresAt: { gt: now },
    },
    data: { status: 'concluida', completedAt: now },
  });
  if (count === 1) {
    return result('concluida', 200, COMPLETE_MESSAGES.concluida, {
      ...occurrence,
      status: 'concluida',
      completedAt: now,
    });
  }

  // Não concluiu: relê para responder com o estado atual (pode ter mudado em paralelo)
  const current = await prisma.taskOccurrence.findUnique({
    where: { id: occurrence.id },
    include,
  });
  if (!current) return notFound();
  if (current.status === 'concluida') {
    return result('ja_validado', 409, COMPLETE_MESSAGES.ja_validado, current);
  }
  if (current.status === 'pendente') {
    // Prazo vencido e o agendador ainda não rodou: já registra como não realizada
    await prisma.taskOccurrence.updateMany({
      where: { id: current.id, status: 'pendente', expiresAt: { lte: now } },
      data: { status: 'falhou' },
    });
  }
  const deadline = formatClock(current.expiresAt);
  return result('prazo_encerrado', 410, COMPLETE_MESSAGES.prazo_encerrado(deadline), {
    ...current,
    status: 'falhou',
  });
}
