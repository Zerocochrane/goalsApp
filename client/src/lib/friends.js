// Avisa o resto do app (contador da aba "Amigos") que pedidos/amizades mudaram.
const EVENT = 'goals:friends-changed';

export function notifyFriendsChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function onFriendsChanged(handler) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
