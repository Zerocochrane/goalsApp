// Comemoração do dia concluído (confete + aviso), compartilhada pelo app inteiro:
// a página de validação e a sequência no cabeçalho (que recarrega sozinha no calendário)
// pedem a comemoração; o <DayCelebration /> do Layout mostra; o diálogo de marco da
// sequência espera o confete terminar para não sobrepor.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { todayInSaoPaulo } from './dates.js';

const STREAK_EVENT = 'goals:streak-changed';

// { id, confetti } — `id` muda a cada comemoração; `confetti` true enquanto o confete cai
let state = { id: 0, confetti: false };
let celebratedDate = null; // evita repetir no mesmo dia nesta aba (respostas em paralelo)
const listeners = new Set();

function setState(next) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Comemora hoje: mostra confete e aviso (uma vez por dia nesta aba) e avisa o servidor,
 * para não repetir ao recarregar nem em outro aparelho.
 */
export function celebrateToday() {
  const today = todayInSaoPaulo();
  if (celebratedDate === today) return;
  celebratedDate = today;
  setState({ id: state.id + 1, confetti: true });
  api('/day/celebrate', { method: 'POST' }).catch(() => {
    // Se falhar, o confete pode reaparecer depois — melhor que perder a comemoração
  });
}

/** O confete terminou (ou nem começou, com movimento reduzido). */
export function finishConfetti() {
  if (state.confetti) setState({ ...state, confetti: false });
}

/** Estado atual da comemoração: `{ id, confetti }`. */
export function useDayCelebration() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Avisa a sequência do cabeçalho que algo mudou (ex.: atividade validada). */
export function notifyStreakChanged() {
  window.dispatchEvent(new Event(STREAK_EVENT));
}

export function onStreakChanged(handler) {
  window.addEventListener(STREAK_EVENT, handler);
  return () => window.removeEventListener(STREAK_EVENT, handler);
}
