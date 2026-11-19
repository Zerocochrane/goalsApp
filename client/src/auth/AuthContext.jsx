import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // status: 'loading' (consultando /api/auth/me) | 'authenticated' | 'anonymous'
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    let cancelled = false;
    api('/auth/me', { skipAuthHandler: true })
      .then(({ user }) => !cancelled && setState({ status: 'authenticated', user }))
      .catch(() => !cancelled && setState({ status: 'anonymous', user: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Se qualquer chamada voltar 401, a sessão acabou: volta para o login.
  useEffect(() => {
    setUnauthorizedHandler(() => setState({ status: 'anonymous', user: null }));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username, password, remember = true) => {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { username, password, remember },
      skipAuthHandler: true,
    });
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  // Sessão aberta por outra rota (ex.: confirmação do telefone no cadastro aberto)
  const signIn = useCallback((user) => {
    setState({ status: 'authenticated', user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', skipAuthHandler: true });
    } finally {
      setState({ status: 'anonymous', user: null });
    }
  }, []);

  // Atualiza os dados do usuário logado (ex.: depois de editar o perfil)
  const updateUser = useCallback((user) => {
    setState((prev) => (prev.status === 'authenticated' ? { ...prev, user } : prev));
  }, []);

  const value = useMemo(
    () => ({ ...state, login, signIn, logout, updateUser }),
    [state, login, signIn, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
