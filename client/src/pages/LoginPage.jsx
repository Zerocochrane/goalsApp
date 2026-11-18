import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { safeRedirect } from '../auth/redirect.js';
import FullPageLoading from '../components/FullPageLoading.jsx';
import t from '../i18n/pt-BR.js';

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const destination = safeRedirect(location.search);

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
      await login(username.trim(), password);
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
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">{t.login.password}</span>
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(error)}
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button button-primary button-block" disabled={submitting}>
          {submitting && <span className="spinner spinner-small" aria-hidden="true" />}
          {submitting ? t.login.submitting : t.login.submit}
        </button>
      </form>
    </div>
  );
}
