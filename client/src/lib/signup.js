// Cadastro pela própria pessoa: modo do servidor e o "ticket" da tela do código.
import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Modo do cadastro (`aprovacao` | `aberto` | `desligado`), ou null enquanto carrega.
 * Sem resposta da API, trata como desligado (some o link).
 */
export function useSignupMode() {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    let ignore = false;
    api('/signup/config', { skipAuthHandler: true })
      .then((data) => !ignore && setMode(data.mode))
      .catch(() => !ignore && setMode('desligado'));
    return () => {
      ignore = true;
    };
  }, []);
  return mode;
}

// O ticket fica na sessionStorage para a tela do código sobreviver a um recarregamento
// (ex.: a pessoa saiu para o WhatsApp e o navegador recarregou a aba).
const KEY = 'goals:signup';

/** { ticket, phone, resendIn, savedAt } salvo, ou null. */
export function loadPendingSignup() {
  try {
    const data = JSON.parse(sessionStorage.getItem(KEY));
    if (!data?.ticket) return null;
    // Desconta o tempo que já passou da espera para reenviar
    const elapsed = Math.floor((Date.now() - (data.savedAt ?? 0)) / 1000);
    return { ...data, resendIn: Math.max(0, (data.resendIn ?? 0) - elapsed) };
  } catch {
    return null;
  }
}

export function savePendingSignup({ ticket, phone, resendIn }) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ticket, phone, resendIn, savedAt: Date.now() }));
  } catch {
    // Sem storage (aba anônima/bloqueada): segue só em memória
  }
}

export function clearPendingSignup() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // idem
  }
}
