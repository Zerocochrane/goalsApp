import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiErrorMessage } from '../lib/errors.js';
import t from '../i18n/pt-BR.js';

function countdownFrom(seconds) {
  const now = Date.now();
  return { now, deadline: now + seconds * 1000 };
}

/** Contagem regressiva em segundos; `restart(s)` recomeça a partir de `s`. */
function useCountdown(initialSeconds) {
  const [clock, setClock] = useState(() => countdownFrom(initialSeconds));
  const remaining = Math.max(0, Math.ceil((clock.deadline - clock.now) / 1000));
  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = setTimeout(() => setClock((c) => ({ ...c, now: Date.now() })), 1000);
    return () => clearTimeout(timer);
  }, [remaining, clock]);
  const restart = useCallback((seconds) => setClock(countdownFrom(seconds)), []);
  return [remaining, restart];
}

/** Mensagem do erro de código vinda da API (inclui as tentativas restantes). */
function codeErrorMessage(err) {
  if ([400, 429].includes(err?.status) && err.message) {
    const left = err.data?.attemptsLeft;
    return left > 0 ? `${err.message}. ${t.phoneCode.attemptsLeft(left)}` : err.message;
  }
  return apiErrorMessage(err);
}

/**
 * Formulário do código de 6 dígitos enviado pelo WhatsApp, com "Reenviar" e contagem
 * regressiva. `onVerify(code)` e `onResend()` chamam a API (rejeitam com ApiError);
 * `onResend` resolve com `{ resendIn }`.
 */
export default function PhoneCodeForm({
  phone,
  resendIn = 0,
  onVerify,
  onResend,
  autoFocus = false,
  idPrefix,
}) {
  const fallbackId = useId();
  const inputId = `${idPrefix || fallbackId}-code`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remaining, restartCountdown] = useCountdown(resendIn);
  const input = useRef(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  async function handleSubmit(event) {
    event.preventDefault();
    setNotice('');
    if (!/^\d{6}$/.test(code)) {
      setError(t.phoneCode.required);
      input.current?.focus();
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onVerify(code);
    } catch (err) {
      setError(codeErrorMessage(err));
      setBusy(false);
      input.current?.select();
    }
  }

  async function handleResend() {
    setResending(true);
    setError('');
    setNotice('');
    try {
      const data = await onResend();
      restartCountdown(data?.resendIn ?? 60);
      setCode('');
      setNotice(t.phoneCode.resent);
      input.current?.focus();
    } catch (err) {
      if (err?.data?.retryAfter) restartCountdown(err.data.retryAfter);
      setError(err?.status === 429 && err.message ? err.message : apiErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <form className="phone-code-form" onSubmit={handleSubmit} noValidate>
      {phone && (
        <p className="phone-code-sent">
          {t.phoneCode.sentTo} <strong className="phone-code-number">{phone}</strong>.
        </p>
      )}

      <div className="field">
        <label className="field-label" htmlFor={inputId}>
          {t.phoneCode.label}
        </label>
        <input
          ref={input}
          id={inputId}
          className="input phone-code-input"
          name="one-time-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          enterKeyHint="done"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={[error && errorId, hintId].filter(Boolean).join(' ')}
        />
        {error && (
          <span id={errorId} className="field-error" role="alert">
            {error}
          </span>
        )}
        <span id={hintId} className="field-hint">
          {t.phoneCode.hint}
        </span>
      </div>

      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>

      <div className="phone-code-actions">
        <button
          type="button"
          className="button button-ghost"
          onClick={handleResend}
          disabled={busy || resending || remaining > 0}
        >
          {resending
            ? t.phoneCode.resending
            : remaining > 0
              ? t.phoneCode.resendIn(remaining)
              : t.phoneCode.resend}
        </button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy && <span className="spinner spinner-small" aria-hidden="true" />}
          {busy ? t.phoneCode.submitting : t.phoneCode.submit}
        </button>
      </div>
    </form>
  );
}
