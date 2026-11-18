// Datas de calendário e recorrência das atividades.
//
// Datas "de calendário" são textos AAAA-MM-DD no fuso America/Sao_Paulo. As contas
// (somar dias, dia da semana) são feitas em UTC sobre esse texto, então não dependem
// do TZ do processo nem de horário de verão. Só "hoje" e "agora" consultam o fuso.

export const TIME_ZONE = 'America/Sao_Paulo';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** true se `value` é uma data AAAA-MM-DD que existe no calendário (rejeita 2026-02-30). */
export function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUtc(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Soma (ou subtrai) dias a uma data AAAA-MM-DD. */
export function addDays(date, days) {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Dia da semana: 0 = domingo, 1 = segunda … 6 = sábado. */
export function weekdayOf(date) {
  return new Date(toUtc(date)).getUTCDay();
}

/** Quantidade de dias de `start` até `end` (end - start). */
export function daysBetween(start, end) {
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MS);
}

/** Todas as datas de `start` a `end`, inclusive. */
export function eachDate(start, end) {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de hoje (AAAA-MM-DD) em America/Sao_Paulo. */
export function todayInSaoPaulo(now = new Date()) {
  return dateFormatter.format(now);
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Diferença (ms) entre o horário local de São Paulo e UTC no instante `ms`. */
function offsetAt(ms) {
  const p = Object.fromEntries(
    partsFormatter.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

/** Instante (Date, UTC) correspondente a `date` hh:mm no horário de São Paulo. */
export function zonedDateTime(date, hour, minute) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  // Duas passadas acertam o offset mesmo perto de uma eventual troca de horário de verão
  let ms = wall - offsetAt(wall);
  ms = wall - offsetAt(ms);
  return new Date(ms);
}

/** "07:05" */
export function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * true se a atividade acontece em `date`: o dia está entre `startDate` e `endDate`
 * (inclusive; endDate null = sem fim) e o dia da semana está em `weekdays`.
 */
export function occursOn(activity, date) {
  if (date < activity.startDate) return false;
  if (activity.endDate && date > activity.endDate) return false;
  return activity.weekdays.includes(weekdayOf(date));
}

/** Datas em que a atividade acontece entre `start` e `end` (inclusive). */
export function occurrenceDates(activity, start, end) {
  return eachDate(start, end).filter((date) => occursOn(activity, date));
}

/** Ordena por horário e, no empate, por nome. */
export function compareByTime(a, b) {
  return a.hour - b.hour || a.minute - b.minute || a.name.localeCompare(b.name, 'pt-BR');
}

/**
 * Status do dia a partir dos status das atividades dele:
 * - `vazio`: nenhuma atividade
 * - `falhou`: qualquer atividade falhou
 * - `concluido`: todas concluídas
 * - `pendente`: o resto (ainda há atividade por fazer)
 */
export function dayStatus(statuses) {
  if (statuses.length === 0) return 'vazio';
  if (statuses.includes('falhou')) return 'falhou';
  if (statuses.every((status) => status === 'concluida')) return 'concluido';
  return 'pendente';
}

/**
 * Monta o calendário de `start` a `end`: para cada dia, as atividades previstas
 * pela recorrência junto com a ocorrência real (se já foi gerada) e o status do dia.
 *
 * - `activities`: { id, name, hour, minute, weekdays, startDate, endDate, active }
 * - `occurrences`: { id, activityId, date, status, …, activity: { name, hour, minute } }
 *
 * Ocorrências reais sem previsão correspondente (ex.: a atividade foi editada depois)
 * também aparecem, com os dados da versão da atividade que as gerou.
 */
export function buildCalendar({ activities, occurrences, start, end, today }) {
  const occurrenceByKey = new Map(occurrences.map((o) => [`${o.activityId}|${o.date}`, o]));
  const used = new Set();

  const days = eachDate(start, end).map((date) => {
    const items = [];
    for (const activity of activities) {
      if (!occursOn(activity, date)) continue;
      const key = `${activity.id}|${date}`;
      const occurrence = occurrenceByKey.get(key) ?? null;
      if (occurrence) used.add(key);
      items.push(toItem(activity, occurrence));
    }
    return { date, items };
  });

  const dayByDate = new Map(days.map((day) => [day.date, day]));
  for (const occurrence of occurrences) {
    if (used.has(`${occurrence.activityId}|${occurrence.date}`)) continue;
    const day = dayByDate.get(occurrence.date);
    if (day)
      day.items.push(toItem({ id: occurrence.activityId, ...occurrence.activity }, occurrence));
  }

  return days.map(({ date, items }) => {
    items.sort(compareByTime);
    return {
      date,
      weekday: weekdayOf(date),
      isToday: date === today,
      isPast: date < today,
      status: dayStatus(items.map((item) => item.status)),
      activities: items,
    };
  });
}

function toItem(activity, occurrence) {
  return {
    activityId: activity.id,
    name: activity.name,
    hour: activity.hour,
    minute: activity.minute,
    time: formatTime(activity.hour, activity.minute),
    // Só a versão ativa pode ser editada/excluída (versões encerradas ficam no histórico)
    editable: activity.active === true,
    status: occurrence?.status ?? 'pendente',
    occurrence: occurrence && {
      id: occurrence.id,
      status: occurrence.status,
      scheduledAt: occurrence.scheduledAt,
      expiresAt: occurrence.expiresAt,
      notifiedAt: occurrence.notifiedAt,
      completedAt: occurrence.completedAt,
    },
  };
}
