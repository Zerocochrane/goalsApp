import { formatLongDate } from '../lib/dates.js';
import t from '../i18n/pt-BR.js';

export default function HomePage() {
  return (
    <section>
      <h1>{t.home.title}</h1>
      <p className="muted">{t.home.today(formatLongDate(new Date()))}</p>
      <p>{t.home.placeholder}</p>
    </section>
  );
}
