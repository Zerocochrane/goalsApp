// /validar/:token — aberto pelo link do WhatsApp. Exige login (RequireAuth guarda o
// destino e volta para cá depois de entrar) e conclui a atividade no servidor.
// Já logado, basta tocar no link: a atividade conclui ao abrir a página.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../lib/api.js';
import { celebrateToday, notifyStreakChanged } from '../lib/dayCelebration.js';
import { TIME_ZONE, formatWeekdayDayMonth, todayInSaoPaulo } from '../lib/dates.js';
import t from '../i18n/pt-BR.js';

// Um POST por token: o StrictMode monta o efeito duas vezes em dev, e o segundo envio
// responderia "já validada" no lugar de "concluída".
const requests = new Map();

const isNetworkError = (status) => [0, 502, 503, 504].includes(status);

function validate(token) {
  if (!requests.has(token)) {
    const request = api(`/occurrences/validate/${encodeURIComponent(token)}`, { method: 'POST' })
      .then((data) => ({ ok: true, code: data.code, message: data.message, data }))
      .catch((err) => {
        // 401: a sessão caiu — o AuthContext manda para o login; rede: permite tentar de novo
        if (err?.status === 401 || isNetworkError(err?.status)) requests.delete(token);
        return {
          ok: false,
          code: err?.data?.code,
          status: err?.status,
          message: err?.data?.message,
          data: err?.data,
        };
      });
    requests.set(token, request);
  }
  return requests.get(token);
}

function messageFor(result) {
  if (result.message) return result.message;
  if (isNetworkError(result.status)) return t.errors.network;
  return t.errors.generic;
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const formatTime = (iso) => (iso ? timeFormatter.format(new Date(iso)) : null);

/** "hoje às 08:00" ou "Segunda, 16 de nov. às 08:00" */
function scheduledText(occurrence) {
  const time = formatTime(occurrence?.scheduledAt);
  if (!time || !occurrence.date) return null;
  const day =
    occurrence.date === todayInSaoPaulo()
      ? t.validate.today
      : formatWeekdayDayMonth(occurrence.date);
  return t.validate.scheduledAt(t.validate.at(day, time));
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export default function ValidatePage() {
  const { token } = useParams();
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    validate(token).then((r) => {
      if (cancelled) return;
      setResult(r);
      if (r.code !== 'concluida') return;
      // Última atividade de hoje: confete logo após "Atividade concluída!"
      if (r.data?.diaConcluidoParaComemorar) celebrateToday();
      notifyStreakChanged(); // a sequência do cabeçalho pode ter mudado
    });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (!result) {
    return (
      <section className="validate-page validate-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>{t.validate.loading}</span>
      </section>
    );
  }

  // "Já validada" também é um final feliz: a atividade está concluída
  const success = result.code === 'concluida' || result.code === 'ja_validado';
  // Link de outra pessoa: o servidor não devolve dados da atividade
  const occurrence = result.code === 'outro_usuario' ? null : result.data?.occurrence;
  const scheduled = scheduledText(occurrence);
  const completed = success ? formatTime(occurrence?.completedAt) : null;
  const canRetry = !result.ok && isNetworkError(result.status);

  function retry() {
    setResult(null);
    setAttempt((n) => n + 1);
  }

  return (
    <section className="validate-page">
      <div
        className="card validate-card"
        data-result={success ? 'success' : 'error'}
        role={success ? 'status' : 'alert'}
      >
        <span className="validate-icon" aria-hidden="true">
          {success ? <CheckIcon /> : <CrossIcon />}
        </span>
        <h1 className="validate-title">{messageFor(result)}</h1>
        {occurrence?.activityName && <p className="validate-activity">{occurrence.activityName}</p>}
        {(scheduled || completed) && (
          <p className="validate-meta">
            {scheduled}
            {scheduled && completed && <br />}
            {completed && t.validate.completedAt(completed)}
          </p>
        )}
        <div className="validate-actions">
          {canRetry && (
            <button type="button" className="button button-primary" onClick={retry}>
              {t.validate.retry}
            </button>
          )}
          <Link to="/" className={`button ${canRetry ? 'button-ghost' : 'button-primary'}`}>
            {t.validate.goToCalendar}
          </Link>
        </div>
      </div>
    </section>
  );
}
