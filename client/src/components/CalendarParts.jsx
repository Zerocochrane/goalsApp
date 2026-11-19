// Peças compartilhadas pelas visões de semana e de mês do calendário.
import { DAY_STATUS_ICON, STATUS_ICON } from '../lib/calendarStatus.js';
import { formatWeekdayDayMonth } from '../lib/dates.js';
import { completionState, useServerNow } from '../lib/serverClock.js';
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

/**
 * Lista de atividades de um dia; com `onEdit`, as editáveis abrem o modal ao clicar.
 * Com `onComplete`, as de hoje dentro do prazo ganham o atalho ✓ (concluir).
 */
export function DayActivities({ day, onEdit, onComplete, completingId = null }) {
  if (day.activities.length === 0) {
    return <p className="week-day-empty muted">{t.calendar.empty}</p>;
  }
  return (
    <ul className="week-activities">
      {day.activities.map((item) => (
        // Chave estável (uma linha por atividade no dia): a linha continua no DOM quando
        // a ocorrência é criada/concluída, e o foco não se perde
        <li key={item.activityId} className="week-activity" data-status={item.status}>
          {item.editable && onEdit ? (
            <button
              type="button"
              className="week-activity-button week-activity-row"
              onClick={(event) => onEdit(event, item)}
              aria-label={t.calendar.editActivityAria(
                item.time,
                item.name,
                t.calendar.activityStatus[item.status],
                activityExtras(item)
                  .map((kind) => t.calendar.extras[kind])
                  .join(', '),
              )}
            >
              <ActivityLabel item={item} />
            </button>
          ) : (
            <div className="week-activity-row">
              <ActivityLabel item={item} />
            </div>
          )}
          {onComplete && day.isToday && item.disponivelEm && (
            <CompleteShortcut
              item={item}
              busy={completingId === item.activityId}
              disabled={completingId !== null}
              onClick={(event) => onComplete(event, item, day.date)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Atalho ✓ na linha da atividade de hoje: aparece só dentro da janela (do horário até
 * o prazo), sozinho, pelo relógio do servidor. Alvo de 44px.
 */
function CompleteShortcut({ item, busy, disabled, onClick }) {
  const now = useServerNow();
  const state = completionState(item, now);
  if (state?.phase !== 'open') return null;
  const left = t.calendar.timeLeft(state.minutesLeft);
  return (
    <button
      type="button"
      className="week-activity-complete"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      aria-label={t.calendar.completeAria(item.name, left)}
      title={`${t.calendar.complete} (${left})`}
    >
      {busy ? (
        <span className="spinner spinner-small" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </button>
  );
}

/** O que a atividade tem além de nome e horário: 'description' | 'video' | 'foto' | 'pdf'. */
function activityExtras(item) {
  return [item.hasDescription && 'description', item.hasVideo && 'video', item.attachment].filter(
    Boolean,
  );
}

const EXTRA_ICON = {
  // Linhas de texto
  description: <path d="M5 6h14M5 11h14M5 16h9" />,
  // Botão de play
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 9.2v5.6l4.8-2.8z" />
    </>
  ),
  // Foto (montanha e sol)
  foto: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-4.5 3.5 3 3-2.5L20 17" />
    </>
  ),
  // Clipe de papel
  pdf: (
    <path d="M15.5 7.5l-6.4 6.4a1.8 1.8 0 002.5 2.5l6.8-6.8a3.5 3.5 0 00-5-5l-7 7a5.2 5.2 0 007.4 7.4l5.7-5.7" />
  ),
};

/** Ícones de descrição/vídeo/anexo na linha (com nome para leitores de tela). */
function ActivityExtras({ item }) {
  const extras = activityExtras(item);
  if (extras.length === 0) return null;
  return (
    <span className="activity-extras">
      {extras.map((kind) => (
        <svg
          key={kind}
          className={`activity-extra activity-extra-${kind}`}
          viewBox="0 0 24 24"
          role="img"
          aria-label={t.calendar.extras[kind]}
        >
          <title>{t.calendar.extras[kind]}</title>
          {EXTRA_ICON[kind]}
        </svg>
      ))}
    </span>
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
        <ActivityExtras item={item} />
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
