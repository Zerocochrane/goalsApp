import { Link } from 'react-router';
import t from '../i18n/pt-BR.js';

export default function NotFoundPage() {
  return (
    <section>
      <h1>{t.notFound.title}</h1>
      <p className="muted">{t.notFound.description}</p>
      <Link to="/">{t.notFound.back}</Link>
    </section>
  );
}
