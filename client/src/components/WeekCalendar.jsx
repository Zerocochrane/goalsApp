import { useEffect, useRef, useState } from 'react';
import ActivityDialog from './ActivityDialog.jsx';
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

// Atualização automática: a cada 60s com a aba visível e ao voltar para a aba
const POLL_INTERVAL_MS = 60_000;

// Ícone de cada status (a cor nunca é o único indicador)
const STATUS_ICON = { concluida: '✓', falhou: '✕', pendente: '○' };
const DAY_STATUS_ICON = { concluido: '✓', falhou: '✕' };

/** Calendário da semana (segunda a domingo), consumindo GET /api/calendar. */
export default function WeekCalendar() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayInSaoPaulo()));
  const [reloadKey, setReloadKey] = useState(0);
  // { key, weekStart, days } da última resposta; `key` identifica a semana/recarga que a gerou
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Modal aberto: { date } para criar, { date, activityId } para editar
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  // Elemento que abriu o modal (recebe o foco de volta ao fechar)
  const openerRef = useRef(null);
  // true quando a próxima recarga é automática (falha nela não esconde o calendário)
  const backgroundRef = useRef(false);
  const titleRef = useRef(null);
  // Depois de salvar/excluir: dia cujo foco deve ser restaurado quando a recarga chegar
  const pendingFocusRef = useRef(null);

  const weekEnd = addDays(weekStart, 6);
  const requestKey = `${weekStart}|${reloadKey}`;
  const currentWeekStart = startOfWeek(todayInSaoPaulo());

  useEffect(() => {
    let ignore = false;
    const background = backgroundRef.current;
    backgroundRef.current = false;
    api(`/calendar?start=${weekStart}&end=${addDays(weekStart, 6)}`)
      .then((data) => {
        if (!ignore) setResult({ key: requestKey, weekStart, days: data.days });
      })
      .catch((err) => {
        if (ignore) return;
        // Recarga automática que falhou: mantém os dados atuais e tenta de novo no próximo ciclo
        if (background) {
          setResult((current) => (current ? { ...current, key: requestKey } : current));
          return;
        }
        setError({ key: requestKey, message: apiErrorMessage(err) });
      });
    return () => {
      ignore = true;
    };
  }, [weekStart, requestKey]);

  // Polling a cada 60s (só com a aba visível) e recarga ao voltar para a aba
  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== 'visible') return;
      backgroundRef.current = true;
      setReloadKey((k) => k + 1);
    }
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const loadError = error?.key === requestKey ? error.message : '';
  // Ao recarregar a mesma semana (depois de salvar), mantém os dias atuais na tela
  const days = result?.weekStart === weekStart ? result.days : null;
  const refreshing = result?.key !== requestKey && !loadError;
  const loading = days === null && refreshing;

  function openDialog(event, state) {
    openerRef.current = event.currentTarget;
    setNotice('');
    setDialog(state);
  }

  // Devolve o foco a quem abriu o modal; se sumiu (ex.: atividade excluída), ao botão
  // "Adicionar" do dia ou, por fim, ao título da semana
  function restoreFocus(date) {
    const opener = openerRef.current;
    const target =
      opener?.isConnected && !opener.disabled
        ? opener
        : (document.querySelector(`[data-add-date="${date}"]`) ?? titleRef.current);
    target?.focus();
  }

  useEffect(() => {
    if (pendingFocusRef.current === null || refreshing) return;
    const date = pendingFocusRef.current;
    pendingFocusRef.current = null;
    restoreFocus(date);
  });

  function closeDialog() {
    const { date } = dialog;
    setDialog(null);
    requestAnimationFrame(() => restoreFocus(date));
  }

  function handleDone(message) {
    // O foco volta só depois da recarga, quando a lista já reflete a alteração
    pendingFocusRef.current = dialog.date;
    setDialog(null);
    setNotice(message);
    setReloadKey((k) => k + 1);
  }

  function goToWeek(next) {
    setNotice('');
    setWeekStart(next);
  }

  return (
    <section className="week-calendar" aria-labelledby="week-calendar-title">
      <div className="week-toolbar">
        <h2
          id="week-calendar-title"
          ref={titleRef}
          tabIndex={-1}
          className="week-title"
          aria-live="polite"
        >
          {formatWeekRange(weekStart, weekEnd)}
        </h2>
        <div className="week-nav">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => goToWeek(addDays(weekStart, -7))}
            aria-label={t.calendar.previousAria}
          >
            <span aria-hidden="true">‹</span>
            <span className="week-nav-label">{t.calendar.previous}</span>
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => goToWeek(currentWeekStart)}
            disabled={weekStart === currentWeekStart}
          >
            {t.calendar.today}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => goToWeek(addDays(weekStart, 7))}
            aria-label={t.calendar.nextAria}
          >
            <span className="week-nav-label">{t.calendar.next}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <p className="notice week-notice" role="status" aria-live="polite">
        {notice}
      </p>

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
        <ol className="week-grid" aria-label={t.calendar.daysLabel} aria-busy={refreshing}>
          {days.map((day) => (
            <DayColumn
              key={day.date}
              day={day}
              onCreate={(event) => openDialog(event, { date: day.date })}
              onEdit={(event, item) =>
                openDialog(event, { date: day.date, activityId: item.activityId })
              }
            />
          ))}
        </ol>
      )}

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

      {dialog && (
        <ActivityDialog
          key={`${dialog.date}|${dialog.activityId ?? 'nova'}`}
          date={dialog.date}
          activityId={dialog.activityId ?? null}
          onClose={closeDialog}
          onDone={handleDone}
        />
      )}
    </section>
  );
}

function DayColumn({ day, onCreate, onEdit }) {
  const classes = ['week-day', 'card'];
  if (day.isToday) classes.push('week-day-today');
  if (day.isPast) classes.push('week-day-past');
  else classes.push('week-day-open');

  // Clique em qualquer área livre do dia abre "Nova atividade" (dias passados não).
  // Teclado e leitores de tela usam o botão "Adicionar", que faz o mesmo.
  function handleDayClick(event) {
    if (day.isPast || event.target.closest('button, a, input')) return;
    event.currentTarget.querySelector('[data-add-date]')?.click();
  }

  return (
    <li
      className={classes.join(' ')}
      aria-current={day.isToday ? 'date' : undefined}
      data-status={day.status}
      onClick={handleDayClick}
    >
      <h3 className="week-day-header">
        {/* Celular: "Segunda, 16 de nov." numa linha; desktop: nome em cima, data embaixo */}
        <span className="week-day-full">{formatWeekdayDayMonth(day.date)}</span>
        <span className="week-day-split" aria-hidden="true">
          <span className="week-day-name">{weekdayName(day.date)}</span>
          <span className="week-day-date">{formatDayMonth(day.date)}</span>
        </span>
        {day.isToday && <span className="badge week-day-badge">{t.calendar.todayBadge}</span>}
        {DAY_STATUS_ICON[day.status] && (
          <span className={`badge day-status day-status-${day.status}`}>
            <span aria-hidden="true">{DAY_STATUS_ICON[day.status]}</span>
            {t.calendar.dayStatus[day.status]}
          </span>
        )}
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
              {item.editable ? (
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
      )}

      {!day.isPast && (
        <button
          type="button"
          className="week-add"
          data-add-date={day.date}
          onClick={onCreate}
          aria-label={t.calendar.addActivityAria(formatWeekdayDayMonth(day.date))}
        >
          <span aria-hidden="true">+</span> {t.calendar.addActivity}
        </button>
      )}
    </li>
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
        <span className="week-activity-name">{item.name}</span>
        <span className="sr-only">, {t.calendar.activityStatus[item.status]}</span>
      </span>
    </>
  );
}
