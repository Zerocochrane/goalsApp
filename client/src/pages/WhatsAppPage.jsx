import { useEffect, useId, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Field from '../components/Field.jsx';
import { api } from '../lib/api.js';
import { apiErrorMessage, apiFieldErrors } from '../lib/errors.js';
import { formatPhone } from '../lib/phone.js';
import t from '../i18n/pt-BR.js';

const POLL_MS = 3000;
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
});

function TestForm({ defaultPhone, disabled, onSent }) {
  const textId = useId();
  const [phone, setPhone] = useState(defaultPhone ? formatPhone(defaultPhone) : '');
  const [text, setText] = useState(t.whatsapp.testDefaultText);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setSending(true);
    setError('');
    setFieldErrors({});
    try {
      const data = await api('/whatsapp/test', { method: 'POST', body: { phone, text } });
      onSent(data);
    } catch (err) {
      const fields = apiFieldErrors(err);
      setFieldErrors(fields);
      if (!Object.keys(fields).length) setError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="card wa-card" onSubmit={handleSubmit} noValidate>
      <h2 className="section-title">{t.whatsapp.testTitle}</h2>
      {disabled && <p className="muted">{t.whatsapp.testNeedsConnection}</p>}
      <Field
        label={t.whatsapp.testPhone}
        hint={t.whatsapp.testPhoneHint}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="+55 (32) 99999-9999"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={fieldErrors.phone}
        disabled={sending || disabled}
      />
      <div className="field">
        <label className="field-label" htmlFor={textId}>
          {t.whatsapp.testText}
        </label>
        <textarea
          id={textId}
          className="input wa-textarea"
          rows={3}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={Boolean(fieldErrors.text)}
          disabled={sending || disabled}
        />
        {fieldErrors.text && <span className="field-error">{fieldErrors.text}</span>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={sending || disabled}>
          {sending && <span className="spinner spinner-small" aria-hidden="true" />}
          {sending ? t.whatsapp.testSending : t.whatsapp.testSend}
        </button>
      </div>
    </form>
  );
}

export default function WhatsAppPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Atualiza o status (e o QR Code, que muda a cada ~20s) enquanto a página está aberta
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      api('/whatsapp')
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setLoadError('');
        })
        .catch((err) => !cancelled && setLoadError(apiErrorMessage(err)));
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function run(path, successNotice) {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      setData(await api(path, { method: 'POST' }));
      if (successNotice) setNotice(successNotice);
      return true;
    } catch (err) {
      setActionError(apiErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    if (await run('/whatsapp/logout', t.whatsapp.loggedOut)) setConfirmLogout(false);
  }

  if (!data) {
    return (
      <section>
        <h1>{t.whatsapp.title}</h1>
        {loadError ? (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        ) : (
          <div className="inline-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>{t.app.loading}</span>
          </div>
        )}
      </section>
    );
  }

  const { status, qr, me, lastError, connectedAt, queueLength, logs } = data;
  const canConnect = status === 'disconnected';

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{t.whatsapp.title}</h1>
          <p className="muted">{t.whatsapp.subtitle}</p>
        </div>
      </div>

      <p className="wa-warning">{t.whatsapp.unofficialWarning}</p>

      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>

      <div className="card wa-card">
        <h2 className="section-title">{t.whatsapp.connectionTitle}</h2>
        <p className="wa-status" role="status" aria-live="polite">
          <span className={`wa-dot wa-dot-${status}`} aria-hidden="true" />
          {t.whatsapp.status[status] ?? status}
        </p>
        {status === 'open' && me && (
          <p className="muted">
            {t.whatsapp.connectedAs(formatPhone(me))}
            {connectedAt && ` · ${t.whatsapp.since(dateTime.format(new Date(connectedAt)))}`}
          </p>
        )}
        {queueLength > 0 && <p className="muted">{t.whatsapp.queue(queueLength)}</p>}
        {lastError && status !== 'open' && <p className="form-error">{lastError}</p>}
        {loadError && <p className="form-error">{loadError}</p>}

        {status === 'qr' && qr && (
          <div className="wa-qr">
            <img src={qr} alt={t.whatsapp.qrAlt} width={280} height={280} />
            <ol className="wa-steps">
              {t.whatsapp.qrSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {actionError && (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        )}

        <div className="form-actions">
          {canConnect && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => run('/whatsapp/connect')}
              disabled={busy}
            >
              {busy && <span className="spinner spinner-small" aria-hidden="true" />}
              {t.whatsapp.connect}
            </button>
          )}
          {!canConnect && (
            <button
              type="button"
              className="button button-ghost button-ghost-danger"
              onClick={() => setConfirmLogout(true)}
              disabled={busy}
            >
              {t.whatsapp.logout}
            </button>
          )}
        </div>
      </div>

      <TestForm
        defaultPhone={user.phone}
        disabled={status !== 'open'}
        onSent={(next) => {
          setData(next);
          setNotice(t.whatsapp.testSent);
        }}
      />

      <div className="card wa-card">
        <h2 className="section-title">{t.whatsapp.logsTitle}</h2>
        {logs.length === 0 ? (
          <p className="muted">{t.whatsapp.logsEmpty}</p>
        ) : (
          <ul className="wa-logs">
            {logs.map((log) => (
              <li key={log.id} className="wa-log">
                <span
                  className={`badge ${log.status === 'enviada' ? 'wa-badge-ok' : 'wa-badge-fail'}`}
                >
                  {t.whatsapp.logStatus[log.status]}
                </span>
                <span className="wa-log-meta">
                  {dateTime.format(new Date(log.createdAt))} · {formatPhone(log.phone)}
                </span>
                <span className="wa-log-text">{log.text}</span>
                {log.error && <span className="field-error">{log.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title={t.whatsapp.logoutTitle}
        confirmLabel={t.whatsapp.logoutYes}
        busyLabel={t.whatsapp.logoutBusy}
        busy={busy}
        error={actionError}
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
      >
        {t.whatsapp.logoutText}
      </ConfirmDialog>
    </section>
  );
}
