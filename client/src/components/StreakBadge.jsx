import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from '../lib/api.js';
import { celebrateToday, onStreakChanged, useDayCelebration } from '../lib/dayCelebration.js';
import t from '../i18n/pt-BR.js';

const POLL_INTERVAL_MS = 60_000;

/**
 * Sequência de dias concluídos no cabeçalho (ícone + "X dias") e, ao atingir um
 * marco (10, 20, 30…) ainda não comemorado, um diálogo de parabéns — uma vez por marco.
 * Recarrega ao trocar de página, quando a janela volta a ter foco, a cada minuto e ao
 * validar uma atividade. Se hoje acabou de ficar todo concluído, dispara o confete,
 * que vem antes do diálogo de marco (sem sobrepor).
 */
export default function StreakBadge() {
  const location = useLocation();
  const [streak, setStreak] = useState(null);
  const [celebrating, setCelebrating] = useState(null); // marco sendo comemorado
  const [reloadKey, setReloadKey] = useState(0);
  const { confetti } = useDayCelebration();

  useEffect(() => {
    let ignore = false;
    api('/streak')
      .then((data) => {
        if (ignore) return;
        setStreak(data.atual);
        if (data.diaConcluidoParaComemorar) celebrateToday();
        if (data.marcoPendente) setCelebrating((current) => current ?? data.marcoPendente);
      })
      .catch(() => {
        // Sem a sequência o app segue funcionando; tenta de novo na próxima recarga
      });
    return () => {
      ignore = true;
    };
  }, [location.key, reloadKey]);

  useEffect(() => {
    function refresh() {
      if (document.visibilityState === 'visible') setReloadKey((k) => k + 1);
    }
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const off = onStreakChanged(refresh);
    return () => {
      off();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  async function closeCelebration() {
    setCelebrating(null);
    try {
      await api('/streak/celebrate', { method: 'POST' });
    } catch {
      // Se falhar, o parabéns reaparece na próxima vez — melhor que perdê-lo
    }
  }

  if (streak === null) return null;

  return (
    <>
      <span
        className={`streak-badge${streak > 0 ? ' streak-badge-active' : ''}`}
        title={t.streak.title}
        aria-label={t.streak.aria(streak)}
      >
        <span className="streak-icon" aria-hidden="true">
          🔥
        </span>
        {t.streak.days(streak)}
      </span>
      {/* Enquanto o confete do dia cai, o diálogo de marco espera */}
      <CelebrationDialog milestone={confetti ? null : celebrating} onClose={closeCelebration} />
    </>
  );
}

function CelebrationDialog({ milestone, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  const textId = useId();
  const open = milestone !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog celebration-dialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="celebration-icon" aria-hidden="true">
        🔥
      </div>
      <h2 id={titleId} className="dialog-title">
        {t.streak.celebrationTitle}
      </h2>
      <p id={textId}>{open && t.streak.celebrationText(milestone)}</p>
      <div className="dialog-actions celebration-actions">
        <button type="button" className="button button-primary" onClick={onClose} autoFocus>
          {t.streak.celebrationClose}
        </button>
      </div>
    </dialog>
  );
}
