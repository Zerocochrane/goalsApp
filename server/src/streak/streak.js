// Sequência (streak) de dias concluídos.
//
// Regras:
// - Sequência = dias consecutivos concluídos (todas as atividades do dia feitas)
// - Dias sem atividades são ignorados (não contam e não quebram)
// - Dia ainda em andamento não quebra: hoje pendente, ou um dia anterior com atividade
//   ainda dentro da janela de validação (ex.: atividade às 23:30 validada às 00:10)
// - Dia com falha, ou dia passado pendente já sem como concluir, quebra a sequência
// - A cada 10 dias (10, 20, 30…) há um marco, comemorado uma única vez

export const STREAK_MILESTONE = 10;

/**
 * true se o dia ainda pode virar `concluido`: é hoje (ou futuro) ou tem alguma
 * atividade pendente cuja ocorrência ainda não expirou.
 */
function inProgress(day, today, now) {
  if (day.date >= today) return true;
  return day.activities.some(
    (item) =>
      item.status === 'pendente' &&
      item.occurrence?.expiresAt &&
      new Date(item.occurrence.expiresAt).getTime() > now.getTime(),
  );
}

/**
 * Calcula a sequência atual a partir dos dias do calendário (`buildCalendar`),
 * em qualquer ordem, até `today` inclusive.
 *
 * - `days`: [{ date, status: 'vazio'|'pendente'|'concluido'|'falhou', activities }]
 */
export function computeStreak(days, { today, now = new Date() }) {
  const sorted = days.filter((day) => day.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1));

  let streak = 0;
  for (const day of sorted) {
    if (day.status === 'vazio') continue;
    if (day.status === 'concluido') {
      streak += 1;
      continue;
    }
    if (day.status === 'pendente' && inProgress(day, today, now)) continue;
    break; // falhou, ou pendente que não tem mais como ser concluído
  }
  return streak;
}

/** Maior marco (múltiplo de 10) alcançado pela sequência; 0 se nenhum. */
export function milestoneFor(streak) {
  return Math.floor(streak / STREAK_MILESTONE) * STREAK_MILESTONE;
}

/** Marco a comemorar agora (ainda não comemorado), ou null. */
export function pendingMilestone(streak, lastCelebrated) {
  const milestone = milestoneFor(streak);
  return milestone > 0 && milestone > lastCelebrated ? milestone : null;
}
