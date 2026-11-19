// Relógio do servidor: o relógio do aparelho não é confiável (pode estar adiantado ou
// atrasado), então o app guarda a diferença em relação ao `now` do GET /api/calendar e
// usa "agora do servidor" para habilitar/desabilitar "Concluir atividade". Quem decide
// de verdade é sempre o servidor.
import { useEffect, useState } from 'react';
import { TIME_ZONE } from './dates.js';

let offsetMs = 0;

/** Registra o instante do servidor (ISO) recebido agora. */
export function syncServerClock(serverNowIso) {
  const server = Date.parse(serverNowIso);
  if (Number.isFinite(server)) offsetMs = server - Date.now();
}

/** Agora (ms) no relógio do servidor. */
export function serverNow() {
  return Date.now() + offsetMs;
}

/**
 * Agora (ms, relógio do servidor), atualizado a cada `intervalMs` enquanto `active`.
 * Fica alinhado à virada de cada segundo para o botão habilitar no segundo certo.
 */
export function useServerNow(active = true, intervalMs = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return undefined;
    let timer;
    function tick() {
      const current = serverNow();
      setNow(current);
      timer = setTimeout(tick, intervalMs - (current % intervalMs) + 5);
    }
    tick();
    return () => clearTimeout(timer);
  }, [active, intervalMs]);
  return now;
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "07:30" (São Paulo) a partir de um instante ISO. */
export function formatClock(iso) {
  return timeFormatter.format(new Date(iso));
}

/**
 * Situação de "Concluir atividade" de um item do calendário no instante `now` (ms):
 * - `null`: não se aplica (outro dia, já concluída/falhou ou fora da janela)
 * - `{ phase: 'waiting', from }`: antes do horário ("Disponível às 07:30")
 * - `{ phase: 'open', minutesLeft }`: dentro da janela de 1 hora
 */
export function completionState(item, now) {
  if (!item?.disponivelEm || !item.prazoAte || item.status !== 'pendente') return null;
  const from = Date.parse(item.disponivelEm);
  const until = Date.parse(item.prazoAte);
  if (now >= until) return null;
  if (now < from) return { phase: 'waiting', from: formatClock(item.disponivelEm), at: from };
  return { phase: 'open', minutesLeft: Math.max(1, Math.ceil((until - now) / 60_000)) };
}
