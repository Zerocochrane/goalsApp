import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  formatWeekdayDayMonth,
  startOfWeek,
  todayInSaoPaulo,
  weekdayName,
} from '../lib/dates.js';
import { apiErrorMessage } from '../lib/errors.js';
import t from '../i18n/pt-BR.js';

/** Calendário da semana (segunda a domingo), consumindo GET /api/calendar. */
export default function WeekCalendar() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayInSaoPaulo()));
  const [reloadKey, setReloadKey] = useState(0);
  // { key, days } da última resposta; `key` identifica a semana/recarga que a gerou
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const weekEnd = addDays(weekStart, 6);
  const requestKey = `${weekStart}|${reloadKey}`;
  const currentWeekStart = startOfWeek(todayInSaoPaulo());

  useEffect(() => {
    let ignore = false;
    api(`/calendar?start=${weekStart}&end=${addDays(weekStart, 6)}`)
      .then((data) => {
        if (!ignore) setResult({ key: requestKey, days: data.days });
      })
      .catch((err) => {
        if (!ignore) setError({ key: requestKey, message: apiErrorMessage(err) });
      });
    return () => {
      ignore = true;
    };
  }, [weekStart, requestKey]);

  const loading = result?.key !== requestKey && error?.key !== requestKey;
  const days = result?.key === requestKey ? result.days : null;
  const loadError = error?.key === requestKey ? error.message : '';

  return (
    <section className="week-calendar" aria-labelledby="week-calendar-title">
      <div className="week-toolbar">
        <h2 id="week-calendar-title" className="week-title" aria-live="polite">
          {formatWeekRange(weekStart, weekEnd)}
        </h2>
        <div className="week-nav">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label={t.calendar.previousAria}
          >
            <span aria-hidden="true">‹</span>
            <span className="week-nav-label">{t.calendar.previous}</span>
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setWeekStart(currentWeekStart)}
            disabled={weekStart === currentWeekStart}
          >
            {t.calendar.today}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label={t.calendar.nextAria}
          >
            <span className="week-nav-label">{t.calendar.next}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="form-error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {t.calendar.retry}
          </button>
        </div>
      ) : loading ? (
        <div className="inline-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{t.app.loading}</span>
        </div>
      ) : (
        <ol className="week-grid" aria-label={t.calendar.daysLabel}>
          {days.map((day) => (
            <DayColumn key={day.date} day={day} />
          ))}
        </ol>
      )}
    </section>
  );
}

function DayColumn({ day }) {
  const classes = ['week-day', 'card'];
  if (day.isToday) classes.push('week-day-today');
  if (day.isPast) classes.push('week-day-past');

  return (
    <li className={classes.join(' ')} aria-current={day.isToday ? 'date' : undefined}>
      <h3 className="week-day-header">
        {/* Celular: "Segunda, 16 de nov." numa linha; desktop: nome em cima, data embaixo */}
        <span className="week-day-full">{formatWeekdayDayMonth(day.date)}</span>
        <span className="week-day-split" aria-hidden="true">
          <span className="week-day-name">{weekdayName(day.date)}</span>
          <span className="week-day-date">{formatDayMonth(day.date)}</span>
        </span>
        {day.isToday && <span className="badge week-day-badge">{t.calendar.todayBadge}</span>}
      </h3>

      {day.activities.length === 0 ? (
        <p className="week-day-empty muted">{t.calendar.empty}</p>
      ) : (
        <ul className="week-activities">
          {day.activities.map((item) => (
            <li
              key={`${item.activityId}-${item.occurrence?.id ?? 'prevista'}`}
              className="week-activity"
              data-status={item.status}
            >
              <time className="week-activity-time">{item.time}</time>
              <span className="week-activity-sep" aria-hidden="true">
                {' – '}
              </span>
              <span className="week-activity-name">{item.name}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
