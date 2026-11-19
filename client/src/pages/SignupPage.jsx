import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Field from '../components/Field.jsx';
import FullPageLoading from '../components/FullPageLoading.jsx';
import PhoneCodeForm from '../components/PhoneCodeForm.jsx';
import t from '../i18n/pt-BR.js';
import { api } from '../lib/api.js';
import { apiErrorMessage, apiFieldErrors } from '../lib/errors.js';
import {
  clearPendingSignup,
  loadPendingSignup,
  savePendingSignup,
  useSignupMode,
} from '../lib/signup.js';
import useMediaQuery from '../lib/useMediaQuery.js';

const DESKTOP_QUERY = '(hover: hover) and (pointer: fine)';
const EMPTY_FORM = {
  name: '',
  username: '',
  password: '',
  passwordConfirm: '',
  phone: '',
  website: '', // campo isca (robôs)
};

function SignupForm({ onCreated }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    if (form.password && form.passwordConfirm !== form.password) {
      setFieldErrors({ passwordConfirm: t.signup.passwordMismatch });
      return;
    }
    setBusy(true);
    try {
      const data = await api('/signup', { method: 'POST', body: form, skipAuthHandler: true });
      onCreated(data);
    } catch (err) {
      const fields = apiFieldErrors(err);
      setFieldErrors(fields);
      if (!Object.keys(fields).length) {
        setError(err?.status === 429 && err.message ? err.message : apiErrorMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Field
        label={t.signup.name}
        name="name"
        autoComplete="name"
        autoCapitalize="words"
        enterKeyHint="next"
        value={form.name}
        onChange={set('name')}
        error={fieldErrors.name}
        disabled={busy}
        autoFocus={isDesktop}
        required
      />
      <Field
        label={t.signup.username}
        hint={t.signup.usernameHint}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        value={form.username}
        onChange={set('username')}
        error={fieldErrors.username}
        disabled={busy}
        required
      />
      <Field
        label={t.signup.password}
        hint={t.signup.passwordHint}
        type="password"
        name="new-password"
        autoComplete="new-password"
        enterKeyHint="next"
        value={form.password}
        onChange={set('password')}
        error={fieldErrors.password}
        disabled={busy}
        required
      />
      <Field
        label={t.signup.passwordConfirm}
        type="password"
        name="confirm-password"
        autoComplete="new-password"
        enterKeyHint="next"
        value={form.passwordConfirm}
        onChange={set('passwordConfirm')}
        error={fieldErrors.passwordConfirm}
        disabled={busy}
        required
      />
      <Field
        label={t.signup.phone}
        hint={t.signup.phoneHint}
        type="tel"
        name="phone"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+55 (32) 99999-9999"
        enterKeyHint="go"
        value={form.phone}
        onChange={set('phone')}
        error={fieldErrors.phone}
        disabled={busy}
        required
      />

      {/* Campo isca: escondido de pessoas (e de leitores de tela); robôs costumam preencher */}
      <div className="sr-only" aria-hidden="true">
        <label>
          {t.signup.honeypot}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={set('website')}
          />
        </label>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="button button-primary button-block" disabled={busy}>
        {busy && <span className="spinner spinner-small" aria-hidden="true" />}
        {busy ? t.signup.submitting : t.signup.submit}
      </button>
    </form>
  );
}

function AuthFooter() {
  return (
    <p className="auth-switch">
      {t.signup.haveAccount} <Link to="/login">{t.signup.loginLink}</Link>
    </p>
  );
}

export default function SignupPage() {
  const { status, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mode = useSignupMode();
  // Vindo do login (telefone ainda não confirmado) ou de um recarregamento da tela do código
  const [pending, setPending] = useState(() =>
    location.state?.ticket ? location.state : loadPendingSignup(),
  );
  const [step, setStep] = useState(() => (pending ? 'code' : 'form'));
  const [finishing, setFinishing] = useState(false);

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'authenticated' && !finishing) return <Navigate to="/" replace />;
  if (mode === null && step === 'form') return <FullPageLoading />;

  function handleCreated(data) {
    const next = { ticket: data.ticket, phone: data.phone, resendIn: data.resendIn };
    savePendingSignup(next);
    setPending(next);
    setStep('code');
  }

  async function handleVerify(code) {
    try {
      const data = await api('/signup/verify-phone', {
        method: 'POST',
        body: { ticket: pending.ticket, code },
        skipAuthHandler: true,
      });
      clearPendingSignup();
      if (data.status === 'ativo' && data.user) {
        setFinishing(true);
        signIn(data.user);
        navigate('/', { replace: true });
      } else {
        setStep('pending');
      }
    } catch (err) {
      if (err?.data?.code === 'ticket_invalid') {
        clearPendingSignup();
        setStep('expired');
        return;
      }
      throw err;
    }
  }

  function handleResend() {
    return api('/signup/resend-code', {
      method: 'POST',
      body: { ticket: pending.ticket },
      skipAuthHandler: true,
    }).catch((err) => {
      if (err?.data?.code === 'ticket_invalid') {
        clearPendingSignup();
        setStep('expired');
      }
      throw err;
    });
  }

  let title;
  let body;
  if (step === 'code') {
    title = t.signup.codeTitle;
    body = (
      <PhoneCodeForm
        idPrefix="signup"
        phone={pending.phone}
        resendIn={pending.resendIn}
        onVerify={handleVerify}
        onResend={handleResend}
        autoFocus
      />
    );
  } else if (step === 'pending' || step === 'expired') {
    title = step === 'pending' ? t.signup.pendingTitle : t.signup.title;
    body = (
      <>
        <p className={step === 'pending' ? 'signup-done' : 'form-error'} role="status">
          {step === 'pending' ? t.signup.pendingText : t.signup.ticketExpired}
        </p>
        <Link to="/login" className="button button-primary button-block">
          {t.signup.backToLogin}
        </Link>
      </>
    );
  } else if (mode === 'desligado') {
    title = t.signup.disabledTitle;
    body = (
      <>
        <p className="muted">{t.signup.disabledText}</p>
        <Link to="/login" className="button button-primary button-block">
          {t.signup.backToLogin}
        </Link>
      </>
    );
  } else {
    title = t.signup.title;
    body = (
      <>
        <p className="muted">{t.signup.subtitle}</p>
        <SignupForm onCreated={handleCreated} />
        <AuthFooter />
      </>
    );
  }

  return (
    <div className="full-page-center login-page">
      <div className="card login-card signup-card">
        <p className="login-brand">{t.app.name}</p>
        <h1 className="login-title">{title}</h1>
        {body}
      </div>
    </div>
  );
}
