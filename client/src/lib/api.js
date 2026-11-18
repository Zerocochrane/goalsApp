// Cliente HTTP da API (/api, mesma origem — o cookie de sessão vai junto).

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = falha de rede
    this.data = data;
  }
}

let onUnauthorized = null;

/** Chamado quando uma requisição autenticada volta 401 (sessão expirou). */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function api(path, { method = 'GET', body, skipAuthHandler = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !skipAuthHandler) onUnauthorized?.();
    throw new ApiError(res.status, data?.error || res.statusText, data);
  }
  return data;
}
