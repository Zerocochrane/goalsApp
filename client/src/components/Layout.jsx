import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import t from '../i18n/pt-BR.js';
import StreakBadge from './StreakBadge.jsx';
import ThemeToggle from './ThemeToggle.jsx';

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
  chat: <path d="M4 20l1.4-4.2A8 8 0 1 1 8.4 19L4 20z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
};

/** Link da navegação: ícone (só no celular) + rótulo; o curto substitui o longo no celular. */
function NavItem({ to, end, icon, label, shortLabel }) {
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
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
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
        {user.isMaster && <NavItem to="/usuarios" icon="users" label={t.nav.users} />}
        {user.isMaster && <NavItem to="/whatsapp" icon="chat" label={t.nav.whatsapp} />}
        <NavItem to="/perfil" icon="user" label={t.nav.profile} shortLabel={t.nav.profileShort} />
      </nav>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
