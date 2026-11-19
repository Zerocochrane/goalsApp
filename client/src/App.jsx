import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthContext.jsx';
import RequireAuth from './auth/RequireAuth.jsx';
import RequireMaster from './auth/RequireMaster.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import FriendsPage from './pages/FriendsPage.jsx';
import HomePage from './pages/HomePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import RankingPage from './pages/RankingPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import ValidatePage from './pages/ValidatePage.jsx';
import WhatsAppPage from './pages/WhatsAppPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cadastro" element={<SignupPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="amigos" element={<FriendsPage />} />
              <Route path="amigos/ranking" element={<RankingPage />} />
              <Route path="perfil" element={<ProfilePage />} />
              <Route path="validar/:token" element={<ValidatePage />} />
              <Route element={<RequireMaster />}>
                <Route path="usuarios" element={<UsersPage />} />
                <Route path="whatsapp" element={<WhatsAppPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
