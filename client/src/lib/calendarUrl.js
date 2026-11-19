// Estado do calendário na URL: ?semana=AAAA-MM-DD (visão semanal, a padrão) ou
// ?mes=AAAA-MM (visão mensal). Assim o botão voltar e os links funcionam.
import { addDays, startOfWeek } from './dates.js';

export const WEEK_PARAM = 'semana';
export const MONTH_PARAM = 'mes';

/** Segunda-feira da semana em `?semana=AAAA-MM-DD`, ou null se ausente/inválida. */
export function weekFromParam(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  // Rejeita datas impossíveis (ex.: 2026-02-31), que o Date "corrigiria"
  if (addDays(value, 0) !== value) return null;
  return startOfWeek(value);
}

/** Mês em `?mes=AAAA-MM`, ou null se ausente/inválido. */
export function monthFromParam(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const month = Number(match[2]);
  if (Number(match[1]) < 1970 || month < 1 || month > 12) return null;
  return value;
}
