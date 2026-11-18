// Tema claro/escuro. O valor inicial é aplicado antes do React carregar por um
// script inline em index.html (evita o "flash" de tema errado) — mantenha a
// chave e a lógica de lá em sincronia com estas.
export const THEME_STORAGE_KEY = 'goals-theme';

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function getSystemTheme() {
  return darkQuery()?.matches ? 'dark' : 'light';
}

export function getCurrentTheme() {
  const attr = document.documentElement.dataset.theme;
  return attr === 'light' || attr === 'dark' ? attr : getSystemTheme();
}

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Cor da barra do navegador no celular (<meta name="theme-color">): a mesma do
// cabeçalho (--color-surface). Mantenha em sincronia com index.html.
export const THEME_COLORS = { light: '#ffffff', dark: '#181c22' };

function applyThemeColor(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.removeAttribute('media');
    meta.setAttribute('content', THEME_COLORS[theme]);
  }
}

let transitionTimer;

// Aplica o tema no <html>. Com `animate`, liga por um instante a transição
// suave de cores (classe .theme-transition em global.css).
export function applyTheme(theme, { animate = false } = {}) {
  const root = document.documentElement;
  if (animate && !prefersReducedMotion()) {
    root.classList.add('theme-transition');
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 400);
  }
  root.dataset.theme = theme;
  applyThemeColor(theme);
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Armazenamento indisponível (modo privado etc.): vale só para esta sessão.
  }
}

// Avisa quando o tema do sistema muda (usado só enquanto não há preferência salva).
export function onSystemThemeChange(callback) {
  const query = darkQuery();
  if (!query) return () => {};
  const handler = (event) => callback(event.matches ? 'dark' : 'light');
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}
