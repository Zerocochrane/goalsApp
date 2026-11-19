// Concluir uma atividade de hoje pelo site (POST /api/activities/:id/complete).
// Mesmo efeito do link do WhatsApp: atualiza a sequência e, se foi a última do dia,
// solta o confete.
import { api } from './api.js';
import { celebrateToday, notifyStreakChanged } from './dayCelebration.js';
import { apiErrorMessage } from './errors.js';
import t from '../i18n/pt-BR.js';

/** Resolve `{ ok, message }` (nunca rejeita). */
export async function completeActivity(activityId) {
  try {
    const data = await api(`/activities/${activityId}/complete`, { method: 'POST' });
    notifyStreakChanged();
    if (data?.diaConcluidoParaComemorar) celebrateToday();
    return { ok: true, message: data?.message || t.calendar.completed };
  } catch (err) {
    // 409 (antes do horário / já concluída) e 410 (prazo encerrado) trazem a mensagem
    return { ok: false, message: err?.data?.message || apiErrorMessage(err) };
  }
}
