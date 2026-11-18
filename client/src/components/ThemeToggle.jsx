import { useEffect, useState } from 'react';
import t from '../i18n/pt-BR.js';
import {
  applyTheme,
  getCurrentTheme,
  getStoredTheme,
  onSystemThemeChange,
  saveTheme,
} from '../lib/theme.js';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getCurrentTheme);

  // Sem preferência salva, acompanha o tema do sistema em tempo real.
  useEffect(
    () =>
      onSystemThemeChange((systemTheme) => {
        if (getStoredTheme()) return;
        applyTheme(systemTheme, { animate: true });
        setTheme(systemTheme);
      }),
    [],
  );

  function handleClick() {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, { animate: true });
    saveTheme(next);
    setTheme(next);
  }

  const label = theme === 'dark' ? t.theme.activateLight : t.theme.activateDark;

  return (
    <button
      type="button"
      className="theme-toggle"
      data-theme-icon={theme}
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      <svg
        className="theme-icon"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <g className="theme-icon-sun">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </g>
        <path className="theme-icon-moon" d="M19.5 14.2A7.5 7.5 0 1 1 9.8 4.5a7 7 0 0 0 9.7 9.7z" />
      </svg>
    </button>
  );
}
