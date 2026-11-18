import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import t from '../i18n/pt-BR.js';

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
          {/* Espaço reservado: sequência de dias (streak) */}
          <div className="header-slot" data-slot="streak" />
          {/* Espaço reservado: alternância de tema claro/escuro */}
          <div className="header-slot" data-slot="theme" />

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

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
