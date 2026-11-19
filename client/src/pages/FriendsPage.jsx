import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Field from '../components/Field.jsx';
import FriendsTabs from '../components/FriendsTabs.jsx';
import { api } from '../lib/api.js';
import { TIME_ZONE } from '../lib/dates.js';
import { apiErrorMessage, apiFieldErrors } from '../lib/errors.js';
import { notifyFriendsChanged } from '../lib/friends.js';
import t from '../i18n/pt-BR.js';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const formatDate = (iso) => dateFormatter.format(new Date(iso));

function AddFriendForm({ onSent }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    const value = username.trim();
    if (!value.replace(/^@/, '')) {
      setError(t.friends.addRequired);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { pedido } = await api('/friends/requests', {
        method: 'POST',
        body: { username: value },
      });
      setUsername('');
      onSent(pedido);
    } catch (err) {
      setError(
        apiFieldErrors(err).username || (err.status === 429 ? err.message : apiErrorMessage(err)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card friends-add" onSubmit={handleSubmit} noValidate>
      <h2 className="section-title">{t.friends.addTitle}</h2>
      <div className="friends-add-row">
        <Field
          className="friends-add-field"
          label={t.friends.addLabel}
          hint={t.friends.addHint}
          name="friend-username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="@usuario"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={error}
          disabled={busy}
        />
        <button type="submit" className="button button-primary friends-add-submit" disabled={busy}>
          {busy && <span className="spinner spinner-small" aria-hidden="true" />}
          {busy ? t.friends.addSending : t.friends.addSubmit}
        </button>
      </div>
    </form>
  );
}

function PersonInfo({ user, children }) {
  return (
    <div className="user-info">
      <p className="user-name">{user.name}</p>
      <p className="muted user-meta">
        @{user.username}
        {children}
      </p>
    </div>
  );
}

export default function FriendsPage() {
  const { user: me } = useAuth();
  const [data, setData] = useState(null); // { amigos, recebidos, enviados }
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyKey, setBusyKey] = useState(null); // ação em andamento, ex.: "accept:12"
  const [toRemove, setToRemove] = useState(null);
  const [removeError, setRemoveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api('/friends')
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoadError('');
      })
      .catch((err) => !cancelled && setLoadError(apiErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  function retry() {
    setLoadError('');
    setData(null);
    reload();
  }

  /** Roda uma ação de pedido/amizade, mostra o aviso e recarrega a lista. */
  async function run(key, request, message) {
    setBusyKey(key);
    setNotice('');
    setActionError('');
    try {
      await request();
      setNotice(message);
      notifyFriendsChanged();
      reload();
      return true;
    } catch (err) {
      setActionError(apiErrorMessage(err));
      reload(); // o pedido pode ter sido cancelado/aceito pelo outro lado
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemove() {
    setRemoveError('');
    setBusyKey(`remove:${toRemove.id}`);
    try {
      await api(`/friends/${toRemove.id}`, { method: 'DELETE' });
      setNotice(t.friends.removed(toRemove.name));
      setActionError('');
      setToRemove(null);
      notifyFriendsChanged();
      reload();
    } catch (err) {
      setRemoveError(apiErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  const busy = busyKey !== null;

  return (
    <section className="friends-page">
      <FriendsTabs />
      <div className="page-header">
        <div>
          <h1>{t.friends.title}</h1>
          <p className="muted">{t.friends.subtitle}</p>
          <p className="muted friends-you">{t.friends.yourUsername(me.username)}</p>
        </div>
      </div>

      <AddFriendForm
        onSent={(pedido) => {
          setActionError('');
          setNotice(t.friends.sent(pedido.user.username));
          reload();
        }}
      />

      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {loadError ? (
        <div className="form-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="button button-ghost" onClick={retry}>
            {t.friends.retry}
          </button>
        </div>
      ) : data === null ? (
        <div className="inline-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{t.app.loading}</span>
        </div>
      ) : (
        <>
          {data.recebidos.length > 0 && (
            <section className="friends-section" aria-labelledby="friends-received">
              <h2 id="friends-received" className="section-title">
                {t.friends.receivedTitle} <span className="badge">{data.recebidos.length}</span>
              </h2>
              <ul className="user-list">
                {data.recebidos.map((p) => (
                  <li key={p.id} className="card user-item">
                    <PersonInfo user={p.user}>
                      {' · '}
                      {t.friends.receivedAt(formatDate(p.createdAt))}
                    </PersonInfo>
                    <div className="user-actions">
                      <button
                        type="button"
                        className="button button-primary"
                        aria-label={t.friends.acceptAria(p.user.name)}
                        disabled={busy}
                        onClick={() =>
                          run(
                            `accept:${p.id}`,
                            () => api(`/friends/requests/${p.id}/accept`, { method: 'POST' }),
                            t.friends.accepted(p.user.name),
                          )
                        }
                      >
                        {busyKey === `accept:${p.id}` && (
                          <span className="spinner spinner-small" aria-hidden="true" />
                        )}
                        {t.friends.accept}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost"
                        aria-label={t.friends.declineAria(p.user.name)}
                        disabled={busy}
                        onClick={() =>
                          run(
                            `decline:${p.id}`,
                            () => api(`/friends/requests/${p.id}/decline`, { method: 'POST' }),
                            t.friends.declined(p.user.name),
                          )
                        }
                      >
                        {t.friends.decline}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="friends-section" aria-labelledby="friends-list">
            <h2 id="friends-list" className="section-title">
              {t.friends.friendsTitle}
              {data.amigos.length > 0 && (
                <span className="muted friends-count">
                  {' · '}
                  {t.friends.friendsCount(data.amigos.length)}
                </span>
              )}
            </h2>
            {data.amigos.length === 0 ? (
              <p className="card friends-empty muted">{t.friends.empty}</p>
            ) : (
              <ul className="user-list">
                {data.amigos.map((f) => (
                  <li key={f.id} className="card user-item">
                    <div className="user-info">
                      <p className="user-name">{f.name}</p>
                      <p className="muted user-meta">@{f.username}</p>
                      <p className="friends-progress">
                        <span
                          className={`friend-streak${f.atual > 0 ? ' friend-streak-active' : ''}`}
                        >
                          <span className="friend-streak-icon" aria-hidden="true">
                            🔥
                          </span>
                          {t.friends.streak(f.atual)}
                        </span>
                        <span className="muted">{t.friends.completedDays(f.diasConcluidos)}</span>
                      </p>
                    </div>
                    <div className="user-actions">
                      <button
                        type="button"
                        className="button button-ghost button-ghost-danger"
                        aria-label={t.friends.removeAria(f.name)}
                        disabled={busy}
                        onClick={() => {
                          setRemoveError('');
                          setToRemove(f);
                        }}
                      >
                        {t.friends.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.enviados.length > 0 && (
            <section className="friends-section" aria-labelledby="friends-sent">
              <h2 id="friends-sent" className="section-title">
                {t.friends.sentTitle}
              </h2>
              <ul className="user-list">
                {data.enviados.map((p) => (
                  <li key={p.id} className="card user-item">
                    <PersonInfo user={p.user}>
                      {' · '}
                      {t.friends.sentAt(formatDate(p.createdAt))}
                    </PersonInfo>
                    <div className="user-actions">
                      <button
                        type="button"
                        className="button button-ghost button-ghost-danger"
                        aria-label={t.friends.cancelAria(p.user.name)}
                        disabled={busy}
                        onClick={() =>
                          run(
                            `cancel:${p.id}`,
                            () => api(`/friends/requests/${p.id}`, { method: 'DELETE' }),
                            t.friends.canceled(p.user.name),
                          )
                        }
                      >
                        {t.friends.cancel}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(toRemove)}
        title={t.friends.confirmTitle}
        confirmLabel={t.friends.confirmYes}
        busyLabel={t.friends.confirmBusy}
        busy={busyKey?.startsWith('remove:') ?? false}
        error={removeError}
        onConfirm={handleRemove}
        onCancel={() => setToRemove(null)}
      >
        {toRemove && t.friends.confirmText(toRemove.name)}
      </ConfirmDialog>
    </section>
  );
}
