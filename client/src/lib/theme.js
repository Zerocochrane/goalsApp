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

let fadeTimer;

// Aplica o tema no <html>. Com `animate`, usa a mesma animação do Site: as cores
// novas "lavam" a página como uma onda de cima para baixo (View Transitions API);
// nos navegadores sem suporte as cores mudam suavemente (.theme-transition).
export function applyTheme(theme, { animate = false } = {}) {
  const root = document.documentElement;
  const commit = () => {
    root.dataset.theme = theme;
    applyThemeColor(theme);
  };
  if (!animate || prefersReducedMotion() || root.dataset.theme === theme) {
    commit();
    return;
  }
  if (typeof document.startViewTransition === 'function') {
    root.classList.add('theme-wave');
    const transition = document.startViewTransition(commit);
    transition.finished.finally(() => root.classList.remove('theme-wave'));
    return;
  }
  root.classList.add('theme-transition');
  commit();
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => root.classList.remove('theme-transition'), 700);
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
