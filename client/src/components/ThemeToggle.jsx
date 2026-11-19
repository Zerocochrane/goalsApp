import { useEffect, useId, useState } from 'react';
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
  // id único para a máscara do SVG (sem os caracteres especiais do useId)
  const maskId = `theme-cut-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Mesmo ícone do Site: no escuro o disco cresce, a "sombra" desliza por cima
  // formando o crescente e os raios recolhem girando — e volta no claro.
  return (
    <button
      type="button"
      className={`theme-toggle${theme === 'dark' ? ' is-dark' : ''}`}
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <mask id={maskId}>
          <rect x="0" y="0" width="24" height="24" fill="#fff" />
          <circle className="tt-cut" cx="16.6" cy="7.6" r="6" fill="#000" />
        </mask>
        <circle className="tt-disc" cx="12" cy="12" r="7.6" mask={`url(#${maskId})`} />
        <g className="tt-rays">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="12" y1="2.2" x2="12" y2="4.2" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      </svg>
    </button>
  );
}
