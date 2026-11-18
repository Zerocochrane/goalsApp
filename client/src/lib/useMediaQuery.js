import { useCallback, useSyncExternalStore } from 'react';

/** `true` enquanto a media query casar (reage a mudanças de tamanho/orientação). */
export default function useMediaQuery(query) {
  const subscribe = useCallback(
    (callback) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', callback);
      return () => list.removeEventListener('change', callback);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Mesmo ponto de quebra do CSS em que os diálogos viram bottom sheet. */
export const SHEET_QUERY = '(max-width: 480px)';
