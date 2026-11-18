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

/** Segunda-feira da semana de `date` (AAAA-MM-DD). */
export function startOfWeek(date) {
  const weekday = new Date(toUtc(date)).getUTCDay(); // 0 = domingo
  return addDays(date, -((weekday + 6) % 7));
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
