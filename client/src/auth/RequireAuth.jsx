import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext.jsx';
import { loginPathFor } from './redirect.js';
import FullPageLoading from '../components/FullPageLoading.jsx';

/** Rotas filhas só com sessão; sem sessão, vai para /login guardando o destino. */
export default function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'anonymous') return <Navigate to={loginPathFor(location)} replace />;
  return <Outlet />;
}
