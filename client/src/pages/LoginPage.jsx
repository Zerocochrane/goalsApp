import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { safeRedirect } from '../auth/redirect.js';
import FullPageLoading from '../components/FullPageLoading.jsx';
import t from '../i18n/pt-BR.js';
import { isInAppBrowser } from '../lib/inAppBrowser.js';
import useMediaQuery from '../lib/useMediaQuery.js';

// Mouse/trackpad: foca o usuário ao abrir. No celular o autoFocus abre o teclado e
// cobre a tela antes de a pessoa ver o formulário.
const DESKTOP_QUERY = '(hover: hover) and (pointer: fine)';
const TOUCH_QUERY = '(pointer: coarse)';

function EyeIcon({ crossed }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

function errorMessage(err) {
  // 0 = sem rede; 502/503/504 = proxy sem resposta da API
  if ([0, 502, 503, 504].includes(err?.status)) return t.errors.network;
  if (err?.status === 401) return t.login.invalid;
  if (err?.status === 429) return t.login.tooManyAttempts;
  if (err?.status === 400) return t.login.required;
  return t.errors.generic;
}

export default function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const destination = safeRedirect(location.search);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isTouch = useMediaQuery(TOUCH_QUERY);
  const showInAppHint = isInAppBrowser() || (isTouch && destination.startsWith('/validar/'));

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'authenticated' && !submitting) return <Navigate to={destination} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError(t.login.required);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password, remember);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="full-page-center login-page">
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <p className="login-brand">{t.app.name}</p>
        <h1 className="login-title">{t.login.title}</h1>
        <p className="muted">{t.login.subtitle}</p>

        <label className="field">
          <span className="field-label">{t.login.username}</span>
          <input
            className="input"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(error)}
            enterKeyHint="next"
            autoFocus={isDesktop}
          />
        </label>

        <div className="field">
          <label className="field-label" htmlFor="login-password">
            {t.login.password}
          </label>
          <div className="password-field">
            <input
              id="login-password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(error)}
              enterKeyHint="go"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t.login.hidePassword : t.login.showPassword}
              aria-controls="login-password"
              disabled={submitting}
            >
              <EyeIcon crossed={showPassword} />
            </button>
          </div>
        </div>

        <label className="login-remember">
          <input
            type="checkbox"
            name="remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={submitting}
            aria-describedby="login-remember-hint"
          />
          <span>{t.login.remember}</span>
        </label>
        <p id="login-remember-hint" className="field-hint login-remember-hint">
          {t.login.rememberHint}
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button button-primary button-block" disabled={submitting}>
          {submitting && <span className="spinner spinner-small" aria-hidden="true" />}
          {submitting ? t.login.submitting : t.login.submit}
        </button>

        {showInAppHint && (
          <aside className="login-inapp-hint">
            <p className="login-inapp-title">{t.login.inAppTitle}</p>
            <p>{t.login.inAppText}</p>
          </aside>
        )}
      </form>
    </div>
  );
}
