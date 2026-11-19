import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { apiErrorMessage } from './errors.js';

// Atualização automática: a cada 60s com a aba visível e ao voltar para a aba
const POLL_INTERVAL_MS = 60_000;

/**
 * Dias de GET /api/calendar entre `start` e `end` (AAAA-MM-DD), com recarga
 * automática. Usado pelas visões de semana e de mês.
 *
 * - `days`: dias do período atual (null enquanto o período ainda não carregou)
 * - `loading`: primeira carga do período; `refreshing`: qualquer carga em andamento
 * - `loadError`: mensagem da última falha (recargas automáticas não mostram erro)
 * - `reload()`: recarrega (ex.: depois de salvar uma atividade)
 */
export default function useCalendarDays(start, end) {
  const [reloadKey, setReloadKey] = useState(0);
  // { key, range, days } da última resposta; `key` identifica o período/recarga que a gerou
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // true quando a próxima recarga é automática (falha nela não esconde o calendário)
  const backgroundRef = useRef(false);

  const range = `${start}|${end}`;
  const requestKey = `${range}|${reloadKey}`;

  useEffect(() => {
    let ignore = false;
    const background = backgroundRef.current;
    backgroundRef.current = false;
    api(`/calendar?start=${start}&end=${end}`)
      .then((data) => {
        if (!ignore) setResult({ key: requestKey, range, days: data.days });
      })
      .catch((err) => {
        if (ignore) return;
        // Recarga automática que falhou: mantém os dados atuais e tenta de novo no próximo ciclo
        if (background) {
          setResult((current) => (current ? { ...current, key: requestKey } : current));
          return;
        }
        setError({ key: requestKey, message: apiErrorMessage(err) });
      });
    return () => {
      ignore = true;
    };
  }, [start, end, range, requestKey]);

  // Polling a cada 60s (só com a aba visível) e recarga ao voltar para a aba
  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== 'visible') return;
      backgroundRef.current = true;
      setReloadKey((k) => k + 1);
    }
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const loadError = error?.key === requestKey ? error.message : '';
  // Ao recarregar o mesmo período (depois de salvar), mantém os dias atuais na tela
  const days = result?.range === range ? result.days : null;
  const refreshing = result?.key !== requestKey && !loadError;
  const loading = days === null && refreshing;

  return { days, loading, refreshing, loadError, reload };
}
