// Avisa o resto do app (contador da aba "Usuários") que cadastros pendentes mudaram.
const EVENT = 'goals:users-changed';

export function notifyUsersChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function onUsersChanged(handler) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
