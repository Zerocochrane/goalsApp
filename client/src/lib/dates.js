// Datas sempre formatadas em português (date-fns com locale ptBR).
import { format as dfFormat } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export { ptBR };

/** format() do date-fns já com o locale pt-BR. */
export function format(date, pattern) {
  return dfFormat(date, pattern, { locale: ptBR });
}

/** Ex.: "terça-feira, 18 de novembro de 2026" */
export function formatLongDate(date) {
  return format(date, "EEEE, d 'de' MMMM 'de' yyyy");
}
