// Peças compartilhadas pelas visões de semana e de mês do calendário.
import { DAY_STATUS_ICON, STATUS_ICON } from '../lib/calendarStatus.js';
import { formatWeekdayDayMonth } from '../lib/dates.js';
import t from '../i18n/pt-BR.js';

/** Legenda das cores/ícones dos status. */
export function StatusLegend() {
  return (
    <ul className="status-legend" aria-label={t.calendar.legendLabel}>
      {['concluida', 'falhou', 'pendente'].map((status) => (
        <li key={status}>
          <span className={`status-swatch status-swatch-${status}`} aria-hidden="true">
            {STATUS_ICON[status]}
          </span>
          {t.calendar.legend[status]}
        </li>
      ))}
    </ul>
  );
}

/** Selo "✓ Dia concluído" / "✕ Dia com falha" (nada nos outros status). */
export function DayStatusBadge({ status }) {
  if (!DAY_STATUS_ICON[status]) return null;
  return (
    <span className={`badge day-status day-status-${status}`}>
      <span aria-hidden="true">{DAY_STATUS_ICON[status]}</span>
      {t.calendar.dayStatus[status]}
    </span>
  );
}

/** Erro (com "Tentar novamente") ou carregando, enquanto não há dias para mostrar. */
export function CalendarLoadState({ loadError, onRetry }) {
  if (loadError) {
    return (
      <div className="form-error" role="alert">
        <p>{loadError}</p>
        <button type="button" className="button button-ghost" onClick={onRetry}>
          {t.calendar.retry}
        </button>
      </div>
    );
  }
  return (
    <div className="inline-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{t.app.loading}</span>
    </div>
  );
}

/** Lista de atividades de um dia; com `onEdit`, as editáveis abrem o modal ao clicar. */
export function DayActivities({ day, onEdit }) {
  if (day.activities.length === 0) {
    return <p className="week-day-empty muted">{t.calendar.empty}</p>;
  }
  return (
    <ul className="week-activities">
      {day.activities.map((item) => (
        <li
          key={`${item.activityId}-${item.occurrence?.id ?? 'prevista'}`}
          className="week-activity"
          data-status={item.status}
        >
          {item.editable && onEdit ? (
            <button
              type="button"
              className="week-activity-button week-activity-row"
              onClick={(event) => onEdit(event, item)}
              aria-label={t.calendar.editActivityAria(
                item.time,
                item.name,
                t.calendar.activityStatus[item.status],
              )}
            >
              <ActivityLabel item={item} />
            </button>
          ) : (
            <div className="week-activity-row">
              <ActivityLabel item={item} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ActivityLabel({ item }) {
  return (
    <>
      <span className="status-icon" aria-hidden="true">
        {STATUS_ICON[item.status]}
      </span>
      <span className="week-activity-body">
        <time className="week-activity-time">{item.time}</time>
        <span className="week-activity-sep" aria-hidden="true">
          {' – '}
        </span>
        <span className="week-activity-name" title={item.name}>
          {item.name}
        </span>
        <span className="sr-only">, {t.calendar.activityStatus[item.status]}</span>
      </span>
    </>
  );
}

/** Botão "+ Adicionar" de um dia (abre "Nova atividade"). */
export function AddActivityButton({ date, onClick }) {
  return (
    <button
      type="button"
      className="week-add"
      data-add-date={date}
      onClick={onClick}
      aria-label={t.calendar.addActivityAria(formatWeekdayDayMonth(date))}
    >
      <span aria-hidden="true">+</span> {t.calendar.addActivity}
    </button>
  );
}
