import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { onFriendsChanged } from '../lib/friends.js';
import { onUsersChanged } from '../lib/users.js';
import t from '../i18n/pt-BR.js';
import StreakBadge from './StreakBadge.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const PENDING_POLL_MS = 60_000;

/**
 * Contador de uma aba (pedidos de amizade recebidos, cadastros aguardando aprovação).
 * Recarrega ao trocar de página, quando a página da aba avisa que mudou algo
 * (`onChanged`), ao voltar o foco e a cada minuto. `path` null = desligado.
 */
function usePolledCount(path, pick, onChanged) {
  const location = useLocation();
  const [count, setCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let ignore = false;
    api(path)
      .then((data) => !ignore && setCount(pick(data)))
      .catch(() => {
        // Sem o contador o app segue funcionando
      });
    return () => {
      ignore = true;
    };
  }, [path, pick, location.key, reloadKey]);

  useEffect(() => {
    if (!path) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible') setReloadKey((k) => k + 1);
    };
    const timer = setInterval(refresh, PENDING_POLL_MS);
    window.addEventListener('focus', refresh);
    const off = onChanged(refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      off();
    };
  }, [path, onChanged]);

  return path ? count : 0;
}

const pickReceived = (data) => data.recebidos;
const pickCount = (data) => data.count;

const NAV_ICONS = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v11h5v-6h4v6h5V9" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18 14.3c2.1.7 3.5 2.8 3.5 5.7" />
    </>
  ),
  friends: (
    <>
      <circle cx="8" cy="8.5" r="3" />
      <circle cx="16" cy="8.5" r="3" />
      <path d="M2.5 19c0-3 2.4-5 5.5-5 1.6 0 3 .5 4 1.5 1-1 2.4-1.5 4-1.5 3.1 0 5.5 2 5.5 5" />
    </>
  ),
  chat: <path d="M4 20l1.4-4.2A8 8 0 1 1 8.4 19L4 20z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
};

/** Link da navegação: ícone (só no celular) + rótulo; o curto substitui o longo no celular. */
function NavItem({ to, end, icon, label, shortLabel, count = 0, countLabel }) {
  return (
    <NavLink to={to} end={end} className="app-nav-link">
      <svg
        className="app-nav-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {NAV_ICONS[icon]}
      </svg>
      {shortLabel ? (
        <>
          <span className="app-nav-label-long">{label}</span>
          <span className="app-nav-label-short">{shortLabel}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
      {count > 0 && (
        <>
          <span className="app-nav-count" aria-hidden="true">
            {count > 9 ? '9+' : count}
          </span>
          <span className="sr-only">{countLabel}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const pendingFriends = usePolledCount('/friends/pending', pickReceived, onFriendsChanged);
  // Cadastros aguardando aprovação (só o master vê a aba "Usuários")
  const pendingUsers = usePolledCount(
    user.isMaster ? '/users/pending-count' : null,
    pickCount,
    onUsersChanged,
  );
  // Calendário (início) usa um container mais largo; cabeçalho e abas acompanham
  const isWide = useMatch({ path: '/', end: true }) !== null;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div className={isWide ? 'app-shell app-shell-wide' : 'app-shell'}>
      <header className="app-header">
        <Link to="/" className="app-brand" aria-label={t.header.homeLink}>
          {t.app.name}
        </Link>

        <div className="app-header-actions">
          <div className="header-slot" data-slot="streak">
            <StreakBadge />
          </div>
          <div className="header-slot" data-slot="theme">
            <ThemeToggle />
          </div>

          <span className="app-user">{t.header.greeting(user.name || user.username)}</span>
          <button
            type="button"
            className="button button-ghost"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? t.header.loggingOut : t.header.logout}
          </button>
        </div>
      </header>

      {/* No celular vira barra de abas fixa no rodapé (ícone + rótulo curto) */}
      <nav className="app-nav" aria-label={t.header.nav}>
        <NavItem to="/" end icon="home" label={t.nav.home} />
        <NavItem
          to="/amigos"
          icon="friends"
          label={t.nav.friends}
          count={pendingFriends}
          countLabel={t.nav.friendsPending(pendingFriends)}
        />
        {user.isMaster && (
          <NavItem
            to="/usuarios"
            icon="users"
            label={t.nav.users}
            count={pendingUsers}
            countLabel={t.nav.usersPending(pendingUsers)}
          />
        )}
        {user.isMaster && <NavItem to="/whatsapp" icon="chat" label={t.nav.whatsapp} />}
        <NavItem to="/perfil" icon="user" label={t.nav.profile} shortLabel={t.nav.profileShort} />
      </nav>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
