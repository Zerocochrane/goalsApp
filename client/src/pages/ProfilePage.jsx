import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import Field from '../components/Field.jsx';
import { api } from '../lib/api.js';
import { apiErrorMessage, apiFieldErrors } from '../lib/errors.js';
import { formatPhone } from '../lib/phone.js';
import t from '../i18n/pt-BR.js';

function SubmitButton({ busy, label }) {
  return (
    <button type="submit" className="button button-primary" disabled={busy}>
      {busy && <span className="spinner spinner-small" aria-hidden="true" />}
      {busy ? t.profile.saving : label}
    </button>
  );
}

function PhoneForm() {
  const { user, updateUser } = useAuth();
  const [phone, setPhone] = useState(() => formatPhone(user.phone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { user: saved } = await api('/profile', { method: 'PUT', body: { phone } });
      updateUser(saved);
      setPhone(formatPhone(saved.phone));
      setNotice(t.profile.phoneSaved);
    } catch (err) {
      setError(apiFieldErrors(err).phone || apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card profile-card" onSubmit={handleSubmit} noValidate>
      <h2 className="section-title">{t.profile.phoneSection}</h2>
      <Field
        label={t.profile.phone}
        hint={t.profile.phoneHint}
        type="tel"
        name="phone"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+55 (32) 99999-9999"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={error}
        disabled={busy}
      />
      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>
      <div className="form-actions">
        <SubmitButton busy={busy} label={t.profile.savePhone} />
      </div>
    </form>
  );
}

const EMPTY_PASSWORDS = { currentPassword: '', newPassword: '', confirmPassword: '' };

function PasswordForm() {
  const { user: me, updateUser } = useAuth();
  const [form, setForm] = useState(EMPTY_PASSWORDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState('');

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    setNotice('');
    if (!form.currentPassword || !form.newPassword) {
      setError(t.profile.passwordRequired);
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setFieldErrors({ confirmPassword: t.profile.passwordMismatch });
      return;
    }
    setBusy(true);
    try {
      const { user } = await api('/profile', {
        method: 'PUT',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      updateUser(user);
      setForm(EMPTY_PASSWORDS);
      setNotice(t.profile.passwordSaved);
    } catch (err) {
      const fields = apiFieldErrors(err);
      setFieldErrors(fields);
      if (!Object.keys(fields).length) setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card profile-card" onSubmit={handleSubmit} noValidate>
      <h2 className="section-title">{t.profile.passwordSection}</h2>
      {/* Ajuda gerenciadores de senha a saber de qual conta é a senha */}
      <input type="hidden" name="username" autoComplete="username" value={me.username} />
      <Field
        label={t.profile.currentPassword}
        type="password"
        name="current-password"
        autoComplete="current-password"
        value={form.currentPassword}
        onChange={set('currentPassword')}
        error={fieldErrors.currentPassword}
        disabled={busy}
      />
      <Field
        label={t.profile.newPassword}
        hint={t.profile.passwordHint}
        type="password"
        name="new-password"
        autoComplete="new-password"
        value={form.newPassword}
        onChange={set('newPassword')}
        error={fieldErrors.newPassword}
        disabled={busy}
      />
      <Field
        label={t.profile.confirmPassword}
        type="password"
        name="confirm-password"
        autoComplete="new-password"
        value={form.confirmPassword}
        onChange={set('confirmPassword')}
        error={fieldErrors.confirmPassword}
        disabled={busy}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>
      <div className="form-actions">
        <SubmitButton busy={busy} label={t.profile.savePassword} />
      </div>
    </form>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  return (
    <section>
      <h1>{t.profile.title}</h1>
      <p className="muted">{t.profile.subtitle}</p>

      <div className="card profile-card">
        <dl className="profile-facts">
          <div>
            <dt>{t.profile.name}</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>{t.profile.username}</dt>
            <dd>@{user.username}</dd>
          </div>
        </dl>
        {!user.isMaster && <p className="muted field-hint">{t.profile.nameManaged}</p>}
      </div>

      <PhoneForm />
      <PasswordForm />
    </section>
  );
}
