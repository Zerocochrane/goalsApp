import { NavLink } from 'react-router';
import t from '../i18n/pt-BR.js';

/** Alternância "Amigos | Ranking" no topo das duas páginas da aba Amigos. */
export default function FriendsTabs() {
  return (
    <nav className="segmented friends-tabs" aria-label={t.ranking.sectionNav}>
      <NavLink to="/amigos" end className="segmented-option">
        {t.friends.title}
      </NavLink>
      <NavLink to="/amigos/ranking" className="segmented-option">
        {t.ranking.title}
      </NavLink>
    </nav>
  );
}
