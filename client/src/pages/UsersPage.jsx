import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Field from '../components/Field.jsx';
import { api } from '../lib/api.js';
import { apiErrorMessage, apiFieldErrors } from '../lib/errors.js';
import { formatPhone } from '../lib/phone.js';
import t from '../i18n/pt-BR.js';

const EMPTY_FORM = { name: '', username: '', password: '', phone: '' };

function UserForm({ editing, onSaved, onCancel }) {
  const [form, setForm] = useState(() =>
    editing
      ? {
          name: editing.name,
          username: editing.username,
          password: '',
          phone: formatPhone(editing.phone),
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const firstInput = useRef(null);

  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      const body = { ...form };
      if (editing && !body.password) delete body.password;
      const { user } = editing
        ? await api(`/users/${editing.id}`, { method: 'PUT', body })
        : await api('/users', { method: 'POST', body });
      onSaved(user, Boolean(editing));
    } catch (err) {
      const fields = apiFieldErrors(err);
      setFieldErrors(fields);
      if (!Object.keys(fields).length) setError(apiErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form className="card user-form" onSubmit={handleSubmit} noValidate>
      <h2 className="section-title">
        {editing ? t.users.formEditTitle(editing.name) : t.users.formCreateTitle}
      </h2>
      <div className="form-grid">
        <Field
          ref={firstInput}
          label={t.users.name}
          name="name"
          autoComplete="off"
          value={form.name}
          onChange={set('name')}
          error={fieldErrors.name}
          disabled={saving}
          required
        />
        <Field
          label={t.users.username}
          hint={t.users.usernameHint}
          name="username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={form.username}
          onChange={set('username')}
          error={fieldErrors.username}
          disabled={saving}
          required
        />
        <Field
          label={t.users.password}
          hint={editing ? t.users.passwordEditHint : t.users.passwordHint}
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={fieldErrors.password}
          disabled={saving}
          required={!editing}
        />
        <Field
          label={t.users.phone}
          hint={t.users.phoneHint}
          type="tel"
          name="phone"
          inputMode="tel"
          autoComplete="off"
          placeholder="+55 (32) 99999-9999"
          value={form.phone}
          onChange={set('phone')}
          error={fieldErrors.phone}
          disabled={saving}
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={saving}>
          {t.users.cancel}
        </button>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving && <span className="spinner spinner-small" aria-hidden="true" />}
          {saving ? t.users.saving : t.users.save}
        </button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const { user: me, updateUser } = useAuth();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState('');
  // null = formulário fechado; { mode: 'create' } ou { mode: 'edit', user }
  const [formState, setFormState] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api('/users')
      .then(({ users }) => !cancelled && setUsers(users))
      .catch((err) => !cancelled && setLoadError(apiErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function retry() {
    setLoadError('');
    setUsers(null);
    setReloadKey((k) => k + 1);
  }

  function handleSaved(saved, wasEditing) {
    setUsers((prev) =>
      wasEditing ? prev.map((u) => (u.id === saved.id ? saved : u)) : [...prev, saved],
    );
    if (saved.id === me.id) updateUser(saved);
    setNotice(wasEditing ? t.users.updated(saved.name) : t.users.created(saved.name));
    setFormState(null);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await api(`/users/${toDelete.id}`, { method: 'DELETE' });
      setUsers((prev) => prev.filter((u) => u.id !== toDelete.id));
      setNotice(t.users.removed(toDelete.name));
      if (formState?.user?.id === toDelete.id) setFormState(null);
      setToDelete(null);
    } catch (err) {
      setDeleteError(apiErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{t.users.title}</h1>
          <p className="muted">{t.users.subtitle}</p>
        </div>
        {!formState && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setNotice('');
              setFormState({ mode: 'create' });
            }}
          >
            {t.users.new}
          </button>
        )}
      </div>

      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>

      {formState && (
        <UserForm
          key={formState.user?.id ?? 'new'}
          editing={formState.user}
          onSaved={handleSaved}
          onCancel={() => setFormState(null)}
        />
      )}

      {loadError ? (
        <div className="form-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="button button-ghost" onClick={retry}>
            {t.users.retry}
          </button>
        </div>
      ) : users === null ? (
        <div className="inline-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{t.app.loading}</span>
        </div>
      ) : users.length === 0 ? (
        <p className="muted">{t.users.empty}</p>
      ) : (
        <ul className="user-list" aria-label={t.users.listLabel}>
          {users.map((u) => (
            <li key={u.id} className="card user-item">
              <div className="user-info">
                <p className="user-name">
                  {u.name}
                  {u.isMaster && <span className="badge">{t.users.masterBadge}</span>}
                  {u.id === me.id && <span className="badge badge-muted">{t.users.youBadge}</span>}
                </p>
                <p className="muted user-meta">
                  @{u.username} · {u.phone ? formatPhone(u.phone) : t.users.noPhone}
                </p>
              </div>
              <div className="user-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  aria-label={t.users.editAria(u.name)}
                  onClick={() => {
                    setNotice('');
                    setFormState({ mode: 'edit', user: u });
                  }}
                >
                  {t.users.edit}
                </button>
                {!u.isMaster && u.id !== me.id && (
                  <button
                    type="button"
                    className="button button-ghost button-ghost-danger"
                    aria-label={t.users.removeAria(u.name)}
                    onClick={() => {
                      setDeleteError('');
                      setToDelete(u);
                    }}
                  >
                    {t.users.remove}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={t.users.confirmTitle}
        confirmLabel={t.users.confirmYes}
        busyLabel={t.users.confirmBusy}
        busy={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      >
        {toDelete && t.users.confirmText(toDelete.name)}
      </ConfirmDialog>
    </section>
  );
}
