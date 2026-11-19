import { useEffect, useState } from 'react';
import { finishConfetti, useDayCelebration } from '../lib/dayCelebration.js';
import useMediaQuery from '../lib/useMediaQuery.js';
import t from '../i18n/pt-BR.js';
import Confetti from './Confetti.jsx';

const NOTICE_MS = 5000;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Comemoração do dia concluído: confete (sem ele com movimento reduzido) e um aviso
 * curto, anunciado por leitor de tela. Montado uma vez no Layout.
 */
export default function DayCelebration() {
  const { id, confetti } = useDayCelebration();
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const [noticeId, setNoticeId] = useState(0); // comemoração cujo aviso está visível

  // Novo id → mostra o aviso (ajuste de estado durante a renderização, sem efeito)
  const [seenId, setSeenId] = useState(id);
  if (id !== seenId) {
    setSeenId(id);
    setNoticeId(id);
  }

  useEffect(() => {
    if (!noticeId) return undefined;
    const timer = setTimeout(() => setNoticeId(0), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [noticeId]);

  // Movimento reduzido: sem confete, libera logo o diálogo de marco da sequência
  useEffect(() => {
    if (confetti && reducedMotion) finishConfetti();
  }, [confetti, reducedMotion]);

  const showNotice = noticeId !== 0;

  return (
    <>
      {confetti && !reducedMotion && <Confetti key={id} onDone={finishConfetti} />}
      {/* Região sempre montada: leitores de tela anunciam quando o texto aparece */}
      <div className="day-celebration" role="status" aria-live="polite">
        {showNotice && <p className="day-celebration-notice">{t.dayCelebration.notice}</p>}
      </div>
    </>
  );
}
