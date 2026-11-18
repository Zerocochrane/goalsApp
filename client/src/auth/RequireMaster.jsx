import { Outlet } from 'react-router';
import { useAuth } from './AuthContext.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';

/** Rotas filhas só para o admin master; os demais veem "página não encontrada". */
export default function RequireMaster() {
  const { user } = useAuth();
  if (!user?.isMaster) return <NotFoundPage />;
  return <Outlet />;
}
