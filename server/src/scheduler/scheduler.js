// Agendador das atividades: gera as ocorrências no horário, envia o link de validação
// pelo WhatsApp e marca como `falhou` o que não foi validado em 1 hora.
//
// Cada execução (a cada minuto, via node-cron) faz:
//  1. expira: `pendente` com `expiresAt` vencido → `falhou`;
//  2. gera as ocorrências que já deveriam existir entre `since` e agora (não só as do
//     minuto atual, assim um minuto perdido não perde atividade): dentro da janela de 1h
//     nascem `pendente` e são enviadas; fora dela já nascem `falhou`;
//  3. envia (ou reenvia, se o WhatsApp estava fora) as `pendente` ainda não notificadas.
//
// No start do servidor, a primeira execução olha para trás até RECOVERY_DAYS dias:
// recupera o que deveria ter sido gerado enquanto o servidor estava fora.
// A idempotência vem do índice único (activityId, date): ocorrência existente nunca é
// recriada.
import crypto from 'node:crypto';
import cron from 'node-cron';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { sendMessage as defaultSend } from '../whatsapp/whatsapp.js';
import {
  TIME_ZONE,
  eachDate,
  occursOn,
  todayInSaoPaulo,
  zonedDateTime,
} from '../activities/recurrence.js';

export const VALIDATION_WINDOW_MS = 60 * 60 * 1000; // o link vale 1 hora
export const TICK_LOOKBACK_MS = 24 * 60 * 60 * 1000; // execuções normais olham 1 dia para trás
export const RECOVERY_DAYS = 31; // no start, recupera até 31 dias
export const RETRY_INTERVAL_MS = 2 * 60 * 1000; // reenvio após falha no WhatsApp

const MINUTE_MS = 60 * 1000;

/** Texto enviado no horário da atividade. */
export function buildMessage(activityName, link) {
  return `*${activityName}* deve ser feita agora! Depois de concluir, clique neste link para validar a atividade. ${link}`;
}

/** `APP_URL/validar/<token>` */
export function validationLink(appUrl, token) {
  return `${String(appUrl || '').replace(/\/+$/, '')}/validar/${token}`;
}

/** Token aleatório de 32 bytes, seguro para URL. */
export function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function floorToMinute(date) {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

/**
 * A partir de quando a versão da atividade vale. Uma atividade criada (ou editada antes
 * de valer, ver activities/routes.js) às 10h com horário 7h não gera a ocorrência das 7h
 * daquele dia. Versões encerradas usam `createdAt`, porque o encerramento também muda
 * `updatedAt`.
 */
function effectiveFrom(activity) {
  return floorToMinute(activity.active ? activity.updatedAt : activity.createdAt);
}

/**
 * Ocorrências que deveriam existir com `since` < scheduledAt <= `now`.
 * Função pura (sem banco), usada pelo agendador e pelos testes.
 */
export function dueOccurrences(activities, since, now) {
  const firstDate = todayInSaoPaulo(since);
  const lastDate = todayInSaoPaulo(now);
  const due = [];
  for (const activity of activities) {
    const from = effectiveFrom(activity);
    for (const date of eachDate(firstDate, lastDate)) {
      if (!occursOn(activity, date)) continue;
      const scheduledAt = zonedDateTime(date, activity.hour, activity.minute);
      if (scheduledAt <= since || scheduledAt > now || scheduledAt < from) continue;
      due.push({ activity, date, scheduledAt });
    }
  }
  return due.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/**
 * Cria o agendador. Tudo é injetável para testes com relógio simulado:
 * - `prisma`: cliente do banco
 * - `send(phone, text)`: envio (padrão: fila do WhatsApp); deve rejeitar em caso de falha
 * - `now()`: relógio
 * - `appUrl`: base do link de validação
 */
export function createScheduler({
  prisma = defaultPrisma,
  send = defaultSend,
  now = () => new Date(),
  appUrl = process.env.APP_URL,
  log = (message) => console.log(`[agendador] ${message}`),
} = {}) {
  const inFlight = new Set(); // ocorrências com envio em andamento
  const lastAttempt = new Map(); // id → instante (ms) da última tentativa de envio que falhou
  let running = null;
  let task = null;

  /** `pendente` com prazo vencido → `falhou`. */
  async function expire(at) {
    const { count } = await prisma.taskOccurrence.updateMany({
      where: { status: 'pendente', expiresAt: { lte: at } },
      data: { status: 'falhou' },
    });
    if (count) log(`${count} ocorrência(s) expirada(s) → falhou`);
    return count;
  }

  /** Cria as ocorrências que faltam entre `since` e `at`. */
  async function generate(since, at) {
    const firstDate = todayInSaoPaulo(since);
    const lastDate = todayInSaoPaulo(at);
    const activities = await prisma.activity.findMany({
      where: {
        startDate: { lte: lastDate },
        OR: [{ endDate: null }, { endDate: { gte: firstDate } }],
      },
    });
    const due = dueOccurrences(activities, since, at);
    if (!due.length) return { created: 0, failed: 0 };

    const existing = await prisma.taskOccurrence.findMany({
      where: {
        activityId: { in: [...new Set(due.map((d) => d.activity.id))] },
        date: { gte: firstDate, lte: lastDate },
      },
      select: { activityId: true, date: true },
    });
    const exists = new Set(existing.map((o) => `${o.activityId}|${o.date}`));

    let created = 0;
    let failed = 0;
    for (const { activity, date, scheduledAt } of due) {
      if (exists.has(`${activity.id}|${date}`)) continue;
      const expiresAt = new Date(scheduledAt.getTime() + VALIDATION_WINDOW_MS);
      const status = expiresAt > at ? 'pendente' : 'falhou';
      try {
        await prisma.taskOccurrence.create({
          data: {
            activityId: activity.id,
            userId: activity.userId,
            date,
            scheduledAt,
            expiresAt,
            status,
            token: generateToken(),
          },
        });
        if (status === 'pendente') created++;
        else failed++;
      } catch (err) {
        // Índice único (activityId, date): já foi criada — nada a fazer
        if (err?.code !== 'P2002') throw err;
      }
    }
    if (created || failed) {
      log(`ocorrências geradas: ${created} pendente(s), ${failed} já vencida(s) → falhou`);
    }
    return { created, failed };
  }

  /** Envia o link das `pendente` dentro do prazo que ainda não foram notificadas. */
  async function notify(at) {
    const pending = await prisma.taskOccurrence.findMany({
      where: { status: 'pendente', notifiedAt: null, expiresAt: { gt: at } },
      include: {
        activity: { select: { name: true } },
        user: { select: { phone: true, phoneVerifiedAt: true, status: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    const deliveries = [];
    for (const occurrence of pending) {
      if (occurrence.scheduledAt > at || inFlight.has(occurrence.id)) continue;
      const last = lastAttempt.get(occurrence.id);
      if (last !== undefined && at.getTime() - last < RETRY_INTERVAL_MS) continue;
      const phone = occurrence.user?.phone;
      // Sem telefone, telefone não confirmado (cadastro) ou conta não aprovada: fica
      // pendente (e expira) sem envio
      if (!phone || !occurrence.user.phoneVerifiedAt || occurrence.user.status !== 'ativo') {
        continue;
      }

      inFlight.add(occurrence.id);
      const text = buildMessage(occurrence.activity.name, validationLink(appUrl, occurrence.token));
      deliveries.push(
        Promise.resolve()
          .then(() => send(phone, text))
          .then(async () => {
            lastAttempt.delete(occurrence.id);
            // updateMany: a ocorrência pode ter sido apagada (edição) durante o envio
            await prisma.taskOccurrence.updateMany({
              where: { id: occurrence.id },
              data: { notifiedAt: now() },
            });
          })
          .catch((err) => {
            lastAttempt.set(occurrence.id, at.getTime());
            log(`falha ao enviar ocorrência ${occurrence.id}: ${err?.message ?? err}`);
          })
          .finally(() => inFlight.delete(occurrence.id)),
      );
    }
    return deliveries;
  }

  /**
   * Uma execução completa. `since` (padrão: 1 dia antes de agora) limita até onde olhar
   * para trás ao gerar ocorrências. Resolve depois de gerar; `deliveries` resolve quando
   * os envios (que passam pela fila do WhatsApp) terminarem.
   */
  async function runOnce({ since } = {}) {
    const at = now();
    await expire(at);
    const result = await generate(since ?? new Date(at.getTime() - TICK_LOOKBACK_MS), at);
    const deliveries = await notify(at);
    return { ...result, deliveries: Promise.all(deliveries) };
  }

  /** Igual a runOnce, mas nunca roda duas execuções ao mesmo tempo. */
  function tick(options) {
    if (running) return running;
    running = runOnce(options).finally(() => {
      running = null;
    });
    return running;
  }

  /** Recuperação após reinício: olha RECOVERY_DAYS dias para trás. */
  function recover() {
    const at = now();
    return tick({ since: new Date(at.getTime() - RECOVERY_DAYS * 24 * 60 * MINUTE_MS) });
  }

  /** Recupera o atraso e agenda a execução a cada minuto. */
  function start() {
    const safe = (promise) =>
      promise.catch((err) => console.error('[agendador] falha na execução', err));
    safe(recover());
    task = cron.schedule('* * * * *', () => safe(tick()), { timezone: TIME_ZONE });
    log(`iniciado (a cada minuto, ${TIME_ZONE})`);
  }

  function stop() {
    task?.stop();
    task = null;
  }

  return { expire, generate, notify, tick, recover, start, stop };
}
