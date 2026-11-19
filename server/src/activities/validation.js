// Validação dos campos da atividade. Cada função devolve { value } ou { error }.
import { isValidDate } from './recurrence.js';

export const ACTIVITY_NAME_MAX = 80;

export function parseActivityName(input) {
  if (typeof input !== 'string' || !input.trim()) return { error: 'Informe o nome da atividade' };
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length > ACTIVITY_NAME_MAX) {
    return { error: `Nome deve ter no máximo ${ACTIVITY_NAME_MAX} caracteres` };
  }
  return { value };
}

function parseInteger(input, min, max) {
  const value = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function parseHour(input) {
  const value = parseInteger(input, 0, 23);
  return value === null ? { error: 'Hora deve ser um número de 0 a 23' } : { value };
}

export function parseMinute(input) {
  const value = parseInteger(input, 0, 59);
  return value === null ? { error: 'Minuto deve ser um número de 0 a 59' } : { value };
}

/** Lista de dias 0–6 (0 = domingo). Remove repetidos e devolve ordenada. */
export function parseWeekdays(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'Escolha pelo menos um dia da semana' };
  }
  if (!input.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) {
    return { error: 'Dias da semana inválidos' };
  }
  return { value: [...new Set(input)].sort((a, b) => a - b) };
}

/** Data de início: AAAA-MM-DD, não pode ser anterior a hoje. */
export function parseStartDate(input, today) {
  if (!isValidDate(input)) return { error: 'Data de início inválida (use AAAA-MM-DD)' };
  if (input < today) return { error: 'Não é possível criar atividades em dias passados' };
  return { value: input };
}

export const DESCRIPTION_MAX = 1000;
export const VIDEO_URL_MAX = 500;

/** Descrição opcional: texto puro, quebras de linha preservadas, até 1.000 caracteres. */
export function parseDescription(input) {
  if (input === null || input === undefined) return { value: null };
  if (typeof input !== 'string') return { error: 'Descrição inválida' };
  const value = input
    .replace(/\r\n?/g, '\n')
    // Caracteres de controle (exceto quebra de linha e tab) não têm uso num texto
    .replace(/[^\P{Cc}\n\t]/gu, '')
    .trim();
  if (!value) return { value: null };
  if (value.length > DESCRIPTION_MAX) {
    return { error: 'A descrição deve ter no máximo 1.000 caracteres' };
  }
  return { value };
}

/** Link de vídeo opcional: uma URL https:// completa. */
export function parseVideoUrl(input) {
  if (input === null || input === undefined) return { value: null };
  if (typeof input !== 'string') return { error: 'Link de vídeo inválido' };
  const value = input.trim();
  if (!value) return { value: null };
  const error = { error: 'Informe um link de vídeo válido, começando com https://' };
  if (value.length > VIDEO_URL_MAX || /\s/.test(value)) return error;
  let url;
  try {
    url = new URL(value);
  } catch {
    return error;
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) {
    return error;
  }
  return { value: url.href };
}
