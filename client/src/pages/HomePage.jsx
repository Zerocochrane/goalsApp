import { useSearchParams } from 'react-router';
import MonthCalendar from '../components/MonthCalendar.jsx';
import WeekCalendar from '../components/WeekCalendar.jsx';
import { MONTH_PARAM, WEEK_PARAM, monthFromParam, weekFromParam } from '../lib/calendarUrl.js';
import { formatLongDate, monthOf, startOfWeek, todayInSaoPaulo } from '../lib/dates.js';
import t from '../i18n/pt-BR.js';

export default function HomePage() {
  // Visão na URL: ?mes=AAAA-MM mostra o mês; sem ele, a semana (padrão)
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.has(MONTH_PARAM) ? 'month' : 'week';

  function switchView(next) {
    if (next === view) return;
    const today = todayInSaoPaulo();
    setSearchParams((params) => {
      const updated = new URLSearchParams(params);
      if (next === 'month') {
        // Mês da semana exibida (o de hoje, se for a semana atual)
        const week = weekFromParam(params.get(WEEK_PARAM));
        const date = week && week !== startOfWeek(today) ? week : today;
        updated.delete(WEEK_PARAM);
        updated.set(MONTH_PARAM, monthOf(date));
      } else {
        // Semana do dia 1 do mês exibido (a atual, se for o mês atual)
        const month = monthFromParam(params.get(MONTH_PARAM));
        updated.delete(MONTH_PARAM);
        if (month && month !== monthOf(today)) {
          updated.set(WEEK_PARAM, startOfWeek(`${month}-01`));
        } else {
          updated.delete(WEEK_PARAM);
        }
      }
      return updated;
    });
  }

  return (
    <section>
      <h1>{t.home.title}</h1>
      <p className="muted">{t.home.today(formatLongDate(new Date()))}</p>
      <div className="calendar-view-switch" role="group" aria-label={t.calendar.viewLabel}>
        {[
          ['week', t.calendar.viewWeek],
          ['month', t.calendar.viewMonth],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="calendar-view-option"
            aria-pressed={view === value}
            onClick={() => switchView(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'month' ? <MonthCalendar /> : <WeekCalendar />}
    </section>
  );
}
