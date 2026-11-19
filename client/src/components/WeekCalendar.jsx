import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  AddActivityButton,
  CalendarLoadState,
  DayActivities,
  DayStatusBadge,
  StatusLegend,
} from './CalendarParts.jsx';
import useActivityDialog from './useActivityDialog.jsx';
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  formatWeekdayDayMonth,
  startOfWeek,
  todayInSaoPaulo,
  weekdayName,
} from '../lib/dates.js';
import { WEEK_PARAM, weekFromParam } from '../lib/calendarUrl.js';
import useCalendarDays from '../lib/useCalendarDays.js';
import useMediaQuery from '../lib/useMediaQuery.js';
import t from '../i18n/pt-BR.js';

// Celular e tablet: dias empilhados (mesmo ponto de quebra do CSS)
const STACKED_QUERY = '(max-width: 839px)';
/** Calendário da semana (segunda a domingo), consumindo GET /api/calendar. */
export default function WeekCalendar() {
  // Semana na URL (?semana=…) para o botão voltar e links funcionarem; sem o
  // parâmetro, a semana atual
  const [searchParams, setSearchParams] = useSearchParams();
  const currentWeekStart = startOfWeek(todayInSaoPaulo());
  const weekStart = weekFromParam(searchParams.get(WEEK_PARAM)) ?? currentWeekStart;
  const weekEnd = addDays(weekStart, 6);
  const stacked = useMediaQuery(STACKED_QUERY);
  // Dias passados (semana atual, celular) que o usuário expandiu
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  // Rola até o card de hoje só na primeira carga (navegar entre semanas não rola)
  const autoScrollRef = useRef(true);
  const toolbarRef = useRef(null);
  const titleRef = useRef(null);

  const { days, refreshing, loadError, reload } = useCalendarDays(weekStart, weekEnd);
  const { open, notice, setNotice, dialog } = useActivityDialog({
    reload,
    refreshing,
    fallbackRef: titleRef,
  });

  // Celular: ao abrir o app na semana atual, rola até o card de hoje se ele não
  // estiver inteiro na tela (descontando o cabeçalho e a barra da semana fixos)
  useEffect(() => {
    if (!autoScrollRef.current || days === null) return;
    autoScrollRef.current = false;
    if (!stacked || weekStart !== currentWeekStart) return;
    const card = document.querySelector('.week-day[aria-current="date"]');
    if (!card) return;
    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 0;
    card.style.setProperty('--week-toolbar-height', `${toolbarHeight}px`);
    if (card.getBoundingClientRect().bottom <= window.innerHeight) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [days, stacked, weekStart, currentWeekStart]);

  function toggleDay(date) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function goToWeek(next) {
    setNotice('');
    setSearchParams((params) => {
      const updated = new URLSearchParams(params);
      if (next === currentWeekStart) updated.delete(WEEK_PARAM);
      else updated.set(WEEK_PARAM, next);
      return updated;
    });
  }

  return (
    <section className="week-calendar" aria-labelledby="week-calendar-title">
      <div className="week-toolbar" ref={toolbarRef}>
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

      <StatusLegend />

      <p className="notice week-notice" role="status" aria-live="polite">
        {notice}
      </p>

      {days === null || loadError ? (
        <CalendarLoadState loadError={loadError} onRetry={reload} />
      ) : (
        <ol className="week-grid" aria-label={t.calendar.daysLabel} aria-busy={refreshing}>
          {days.map((day) => {
            const collapsible =
              stacked && weekStart === currentWeekStart && day.isPast && !day.isToday;
            return (
              <DayColumn
                key={day.date}
                day={day}
                collapsible={collapsible}
                expanded={!collapsible || expandedDays.has(day.date)}
                onToggle={() => toggleDay(day.date)}
                onCreate={(event) => open(event, { date: day.date })}
                onEdit={(event, item) =>
                  open(event, { date: day.date, activityId: item.activityId })
                }
              />
            );
          })}
        </ol>
      )}

      {dialog}
    </section>
  );
}

function DayColumn({ day, collapsible, expanded, onToggle, onCreate, onEdit }) {
  const bodyId = useId();
  const classes = ['week-day', 'card'];
  if (!expanded) classes.push('week-day-collapsed');
  if (day.isToday) classes.push('week-day-today');
  if (day.isPast) classes.push('week-day-past');
  else classes.push('week-day-open');

  // Clique em qualquer área livre do dia abre "Nova atividade" (dias passados não).
  // Teclado e leitores de tela usam o botão "Adicionar", que faz o mesmo.
  function handleDayClick(event) {
    if (day.isPast || event.target.closest('button, a, input')) return;
    event.currentTarget.querySelector('[data-add-date]')?.click();
  }

  const headerContent = (
    <>
      {/* Celular: "Segunda, 16 de nov." numa linha; desktop: nome em cima, data embaixo */}
      <span className="week-day-full">{formatWeekdayDayMonth(day.date)}</span>
      <span className="week-day-split" aria-hidden="true">
        <span className="week-day-name">{weekdayName(day.date)}</span>
        <span className="week-day-date">{formatDayMonth(day.date)}</span>
      </span>
      {day.isToday && <span className="badge week-day-badge">{t.calendar.todayBadge}</span>}
      <DayStatusBadge status={day.status} />
    </>
  );

  return (
    <li
      className={classes.join(' ')}
      aria-current={day.isToday ? 'date' : undefined}
      data-status={day.status}
      onClick={handleDayClick}
    >
      <h3 className="week-day-header">
        {collapsible ? (
          // Dia passado no celular: recolhido, tocar no título expande
          <button
            type="button"
            className="week-day-toggle"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            {headerContent}
            <span className="week-day-chevron" aria-hidden="true" />
          </button>
        ) : (
          headerContent
        )}
      </h3>

      <div id={bodyId} className="week-day-body" hidden={!expanded}>
        <DayActivities day={day} onEdit={onEdit} />
      </div>

      {!day.isPast && <AddActivityButton date={day.date} onClick={onCreate} />}
    </li>
  );
}
