// Preserva a URL de destino ao mandar para o login (ex.: link de validação do WhatsApp).

export const REDIRECT_PARAM = 'redirect';

/** Monta /login?redirect=<destino>. */
export function loginPathFor(location) {
  const target = `${location.pathname}${location.search}${location.hash}`;
  if (!target || target === '/') return '/login';
  return `/login?${REDIRECT_PARAM}=${encodeURIComponent(target)}`;
}

/** Lê o destino do login, aceitando só caminhos internos (evita redirecionar para outro site). */
export function safeRedirect(search) {
  const value = new URLSearchParams(search).get(REDIRECT_PARAM);
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  if (value === '/login' || value.startsWith('/login?')) return '/';
  return value;
}
