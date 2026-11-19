// Ranking entre amigos (issue #29) — cálculo puro, sem banco.
//
// Regras (as mesmas do calendário e do contador de sequência):
// - Itens de um dia = atividades previstas pela recorrência + ocorrências reais (uma por
//   atividade e dia). Cada item está concluído, falhou, pendente "aberto" (ainda dá para
//   concluir) ou pendente "vencido" (não dá mais: conta como falha)
// - Pendente aberto: dia de hoje (ou futuro), ou ocorrência pendente ainda dentro do prazo
// - Semana / mês: percentual = concluídas ÷ (concluídas + falhas), só até hoje;
//   desempate por dias concluídos e depois por atividades concluídas
// - Sequência: dias seguidos concluídos (dias vazios e dias em andamento não contam e não
//   quebram); desempate pela maior sequência já alcançada
// - Quem não tem nada vencido no período fica no fim, sem posição ("Sem atividades")
// - Empates dividem a posição (1º, 1º, 3º)
import { addDays, eachDate, occursOn, weekdayOf } from '../activities/recurrence.js';

export const PERIODS = ['semana', 'mes', 'sequencia'];

/** Início e fim (AAAA-MM-DD, inclusive) do período que contém `today`. */
export function periodRange(periodo, today) {
  if (periodo === 'semana') {
    const inicio = addDays(today, -((weekdayOf(today) + 6) % 7)); // segunda-feira
    return { inicio, fim: addDays(inicio, 6) };
  }
  if (periodo === 'mes') {
    const inicio = `${today.slice(0, 7)}-01`;
    const [y, m] = today.split('-').map(Number);
    const fim = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // dia 0 = último do mês
    return { inicio, fim };
  }
  return { inicio: null, fim: today };
}

/**
 * Resumo diário de um usuário, de `start` a `today`, a partir de dados agregados.
 *
 * - `activities`: versões das atividades { id, weekdays, startDate, endDate }
 * - `occurrenceDays`: por dia com ocorrência { date, concluidas, falhas, activityIds }
 *   (`activityIds`: ids de todas as ocorrências do dia, qualquer status)
 * - `openPending`: Set de "activityId|date" das ocorrências pendentes ainda no prazo
 *
 * Devolve [{ date, done, failed, overdue, open, status, inProgress }] (sem dias vazios).
 */
export function summarizeDays({ activities, occurrenceDays, openPending, start, today }) {
  const byDate = new Map(occurrenceDays.map((d) => [d.date, d]));
  const days = [];
  if (!start || start > today) return days;

  for (const date of eachDate(start, today)) {
    const row = byDate.get(date);
    const withOccurrence = new Set(row?.activityIds ?? []);
    const isPastDay = date < today;

    let done = row?.concluidas ?? 0;
    let failed = row?.falhas ?? 0;
    let open = 0;
    let overdue = 0;
    let openOccurrence = false;

    // Ocorrências pendentes: abertas (no prazo, ou o dia ainda não acabou) ou vencidas
    for (const activityId of withOccurrence) {
      if (!openPending.has(`${activityId}|${date}`)) continue;
      open += 1;
      openOccurrence = true;
    }
    const pendingOccurrences = withOccurrence.size - done - failed;
    overdue += pendingOccurrences - open;

    // Previstas pela recorrência que ainda não viraram ocorrência
    for (const activity of activities) {
      if (withOccurrence.has(activity.id) || !occursOn(activity, date)) continue;
      if (isPastDay) overdue += 1;
      else open += 1;
    }

    // Hoje continua em andamento para a sequência (como no contador do topo), mesmo com
    // uma pendente vencida que o agendador ainda não marcou como falha
    const total = done + failed + open + overdue;
    if (total === 0) continue;
    let status = 'pendente';
    if (failed > 0) status = 'falhou';
    else if (done === total) status = 'concluido';

    days.push({
      date,
      done,
      failed,
      overdue,
      open,
      status,
      inProgress: !isPastDay || openOccurrence,
    });
  }
  return days;
}

/** Métricas de um período (dias de `inicio` a `fim`, só até hoje). */
export function periodMetrics(days, { inicio, fim }) {
  let concluidas = 0;
  let total = 0;
  let diasConcluidos = 0;
  for (const day of days) {
    if (day.date < inicio || day.date > fim) continue;
    concluidas += day.done;
    // Vencidas = concluídas + falhas + pendentes que não dá mais para concluir.
    // Pendentes de hoje ainda no prazo ficam de fora (não são falha).
    total += day.done + day.failed + day.overdue;
    if (day.status === 'concluido') diasConcluidos += 1;
  }
  return { concluidas, total, diasConcluidos };
}

/**
 * Sequência atual e maior sequência, com as regras do contador do topo:
 * vazio é ignorado, concluído soma, pendente em andamento não quebra, o resto quebra.
 */
export function streaks(days) {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  let run = 0;
  let melhor = 0;
  for (const day of sorted) {
    if (day.status === 'concluido') run += 1;
    else if (!(day.status === 'pendente' && day.inProgress)) run = 0;
    melhor = Math.max(melhor, run);
  }
  return { atual: run, melhor };
}

/** Compara a / b (frações) sem arredondar: > 0 se a > b. */
function compareRatio(a, b) {
  return a.concluidas * b.total - b.concluidas * a.total;
}

/** Ordem decrescente de desempenho; 0 = empate (mesma posição). */
export function compareEntries(periodo, a, b) {
  if (periodo === 'sequencia') {
    return b.sequencia - a.sequencia || b.melhorSequencia - a.melhorSequencia;
  }
  return compareRatio(b, a) || b.diasConcluidos - a.diasConcluidos || b.concluidas - a.concluidas;
}

/** Percentual inteiro, arredondado para baixo (99,6% não vira 100%). */
export function percentOf(concluidas, total) {
  return total > 0 ? Math.floor((concluidas * 100) / total) : null;
}

/** true se a pessoa não tem nada para ser comparado no período. */
export function hasNoActivities(periodo, entry) {
  return periodo === 'sequencia' ? !entry.temHistorico : entry.total === 0;
}

/**
 * Ordena e numera. Empates dividem a posição (competição: 1º, 1º, 3º); quem não tem
 * atividades vai para o fim com posição null. No empate, "você" primeiro e depois por nome.
 */
export function rankEntries(periodo, entries) {
  const byName = (a, b) =>
    Number(b.voce) - Number(a.voce) || a.usuario.nome.localeCompare(b.usuario.nome, 'pt-BR');
  const ranked = entries.filter((e) => !hasNoActivities(periodo, e));
  const empty = entries.filter((e) => hasNoActivities(periodo, e));
  ranked.sort((a, b) => compareEntries(periodo, a, b) || byName(a, b));
  empty.sort(byName);

  let posicao = 0;
  const result = ranked.map((entry, index) => {
    if (index === 0 || compareEntries(periodo, ranked[index - 1], entry) !== 0) {
      posicao = index + 1;
    }
    return { ...entry, posicao };
  });
  return [...result, ...empty.map((entry) => ({ ...entry, posicao: null }))];
}
