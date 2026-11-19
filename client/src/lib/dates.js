// Datas sempre formatadas em português (date-fns com locale ptBR).
//
// Datas "de calendário" são textos AAAA-MM-DD no fuso America/Sao_Paulo (o mesmo
// formato da API). As contas são feitas em UTC sobre esse texto, então não dependem
// do fuso do navegador nem de horário de verão. Só "hoje" consulta o fuso.
import { format as dfFormat } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export { ptBR };

export const TIME_ZONE = 'America/Sao_Paulo';

const DAY_MS = 24 * 60 * 60 * 1000;

/** format() do date-fns já com o locale pt-BR. */
export function format(date, pattern) {
  return dfFormat(date, pattern, { locale: ptBR });
}

/** Ex.: "terça-feira, 18 de novembro de 2026" */
export function formatLongDate(date) {
  return format(date, "EEEE, d 'de' MMMM 'de' yyyy");
}

const todayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de hoje (AAAA-MM-DD) em America/Sao_Paulo. */
export function todayInSaoPaulo(now = new Date()) {
  return todayFormatter.format(now);
}

function toUtc(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Soma (ou subtrai) dias a uma data AAAA-MM-DD. */
export function addDays(date, days) {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Dia da semana: 0 = domingo, 1 = segunda … 6 = sábado (como na API). */
export function weekdayOf(date) {
  return new Date(toUtc(date)).getUTCDay();
}

/** Segunda-feira da semana de `date` (AAAA-MM-DD). */
export function startOfWeek(date) {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Date local (meia-noite) para formatar com o date-fns sem deslocar o dia. */
export function toLocalDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Nome curto do dia da semana. Ex.: "Segunda" */
export function weekdayName(date) {
  return WEEKDAY_NAMES[toLocalDate(date).getDay()];
}

/** Ex.: "16 de nov." */
export function formatDayMonth(date) {
  return `${format(toLocalDate(date), "d 'de' MMM")}.`;
}

/** Ex.: "Segunda, 16 de nov." */
export function formatWeekdayDayMonth(date) {
  return `${weekdayName(date)}, ${formatDayMonth(date)}`;
}

/**
 * Intervalo da semana. Ex.: "16 a 22 de nov. de 2026",
 * "30 de nov. a 6 de dez. de 2026", "28 de dez. de 2026 a 3 de jan. de 2027".
 */
export function formatWeekRange(start, end) {
  const s = toLocalDate(start);
  const e = toLocalDate(end);
  const endText = `${formatDayMonth(end)} de ${e.getFullYear()}`;
  if (s.getFullYear() !== e.getFullYear()) {
    return `${formatDayMonth(start)} de ${s.getFullYear()} a ${endText}`;
  }
  if (s.getMonth() !== e.getMonth()) return `${formatDayMonth(start)} a ${endText}`;
  return `${s.getDate()} a ${endText}`;
}

/** Mês (AAAA-MM) de uma data AAAA-MM-DD. */
export function monthOf(date) {
  return date.slice(0, 7);
}

/** Soma (ou subtrai) meses a um mês AAAA-MM. */
export function addMonths(month, months) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

/** Último dia (AAAA-MM-DD) do mês AAAA-MM. */
export function endOfMonth(month) {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/**
 * Grade do mês (AAAA-MM): da segunda-feira da semana do dia 1 ao domingo da
 * semana do último dia — 5 ou 6 semanas (4 só em fevereiro começando na segunda).
 */
export function monthGrid(month) {
  const start = startOfWeek(`${month}-01`);
  const end = addDays(startOfWeek(endOfMonth(month)), 6);
  return { start, end };
}

/** Ex.: "Novembro de 2026" */
export function formatMonthYear(month) {
  const text = format(toLocalDate(`${month}-01`), "MMMM 'de' yyyy");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Dia do mês (número) de uma data AAAA-MM-DD. */
export function dayOfMonth(date) {
  return Number(date.slice(8, 10));
}
