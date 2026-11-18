// /validar/:token — aberto pelo link do WhatsApp. Exige login (RequireAuth guarda o
// destino e volta para cá depois de entrar) e conclui a atividade no servidor.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../lib/api.js';
import t from '../i18n/pt-BR.js';

// Um POST por token: o StrictMode monta o efeito duas vezes em dev, e o segundo envio
// responderia "já validada" no lugar de "concluída".
const requests = new Map();

function validate(token) {
  if (!requests.has(token)) {
    const request = api(`/occurrences/validate/${encodeURIComponent(token)}`, { method: 'POST' })
      .then((data) => ({ ok: true, code: data.code, message: data.message, data }))
      .catch((err) => {
        // 401: a sessão caiu — o AuthContext manda para o login; permite tentar de novo
        if (err?.status === 401 || err?.status === 0) requests.delete(token);
        return {
          ok: false,
          code: err?.data?.code,
          status: err?.status,
          message: err?.data?.message,
        };
      });
    requests.set(token, request);
  }
  return requests.get(token);
}

function messageFor(result) {
  if (result.message) return result.message;
  if ([0, 502, 503, 504].includes(result.status)) return t.errors.network;
  return t.errors.generic;
}

export default function ValidatePage() {
  const { token } = useParams();
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    validate(token).then((r) => !cancelled && setResult(r));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!result) {
    return (
      <section className="validate-page" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>{t.validate.loading}</span>
      </section>
    );
  }

  const success = result.ok && result.code === 'concluida';
  const activityName = result.data?.occurrence?.activityName;
  const icon = success ? '✅' : result.code === 'ja_validado' ? 'ℹ️' : '⚠️';

  return (
    <section className="validate-page">
      <div className="card validate-card" role={success ? 'status' : 'alert'}>
        <span className="validate-icon" aria-hidden="true">
          {icon}
        </span>
        <h1 className="validate-title">{messageFor(result)}</h1>
        {success && activityName && <p className="muted">{activityName}</p>}
        <Link to="/" className="button button-primary">
          {t.validate.goToCalendar}
        </Link>
      </div>
    </section>
  );
}
