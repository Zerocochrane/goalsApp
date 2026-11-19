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
import { DAY_STATUS_ICON } from '../lib/calendarStatus.js';
import { MONTH_PARAM, monthFromParam } from '../lib/calendarUrl.js';
import {
  addDays,
  addMonths,
  dayOfMonth,
  formatMonthYear,
  formatWeekdayDayMonth,
  monthGrid,
  monthOf,
  todayInSaoPaulo,
} from '../lib/dates.js';
import useCalendarDays from '../lib/useCalendarDays.js';
import t from '../i18n/pt-BR.js';

// Teclado na grade: setas andam 1 dia / 1 semana
const ARROW_STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * Calendário do mês (semanas de segunda a domingo), consumindo GET /api/calendar.
 * Cada dia mostra o status (cor + ícone) e quantas atividades foram concluídas;
 * tocar num dia mostra o detalhe dele (abaixo da grade, ou ao lado no desktop).
 */
export default function MonthCalendar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayInSaoPaulo();
  const currentMonth = monthOf(today);
  const month = monthFromParam(searchParams.get(MONTH_PARAM)) ?? currentMonth;
  const { start, end } = monthGrid(month);
  const titleRef = useRef(null);
  const gridRef = useRef(null);
  const detailRef = useRef(null);
  const detailId = useId();
  // Dia escolhido no mês exibido; sem escolha, hoje (se o mês for o atual)
  const [selection, setSelection] = useState(null);
  const selectedDate =
    selection?.month === month ? selection.date : month === currentMonth ? today : null;
  // Rola até o detalhe quando o dia é escolhido pelo toque/clique
  const scrollToDetailRef = useRef(false);

  const { days, refreshing, loadError, reload } = useCalendarDays(start, end);
  const { open, complete, completingId, notice, noticeIsError, setNotice, dialog } =
    useActivityDialog({
      reload,
      refreshing,
      fallbackRef: titleRef,
    });

  const selectedDay = days?.find((day) => day.date === selectedDate) ?? null;
  // Dia que recebe o Tab na grade (os outros entram pelas setas)
  const focusDate =
    selectedDate && selectedDate >= start && selectedDate <= end ? selectedDate : `${month}-01`;

  // Celular: o detalhe fica abaixo da grade; ao escolher um dia, rola até ele se
  // não estiver visível
  useEffect(() => {
    if (!scrollToDetailRef.current || !selectedDay) return;
    scrollToDetailRef.current = false;
    const detail = detailRef.current;
    if (!detail) return;
    const rect = detail.getBoundingClientRect();
    if (rect.top >= 0 && rect.top + Math.min(rect.height, 160) <= window.innerHeight) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    detail.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [selectedDay]);

  function selectDay(date, { scroll = false } = {}) {
    scrollToDetailRef.current = scroll;
    setNotice('');
    setSelection({ month, date });
  }

  function goToMonth(next) {
    setNotice('');
    setSearchParams((params) => {
      const updated = new URLSearchParams(params);
      updated.set(MONTH_PARAM, next);
      return updated;
    });
  }

  function handleGridKeyDown(event) {
    const date = event.target.closest('[data-date]')?.dataset.date;
    if (!date) return;
    let next = null;
    if (event.key in ARROW_STEP) next = addDays(date, ARROW_STEP[event.key]);
    else if (event.key === 'Home') next = addDays(date, -(dayIndex(date, start) % 7));
    else if (event.key === 'End') next = addDays(date, 6 - (dayIndex(date, start) % 7));
    if (!next) return;
    event.preventDefault();
    if (next < start || next > end) return;
    selectDay(next);
    requestAnimationFrame(() => gridRef.current?.querySelector(`[data-date="${next}"]`)?.focus());
  }

  return (
    <section className="week-calendar month-calendar" aria-labelledby="month-calendar-title">
      <div className="week-toolbar">
        <h2
          id="month-calendar-title"
          ref={titleRef}
          tabIndex={-1}
          className="week-title"
          aria-live="polite"
        >
          {formatMonthYear(month)}
        </h2>
        <div className="week-nav">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => goToMonth(addMonths(month, -1))}
            aria-label={t.calendar.previousMonthAria}
          >
            <span aria-hidden="true">‹</span>
            <span className="week-nav-label">{t.calendar.previous}</span>
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              setSelection(null);
              goToMonth(currentMonth);
            }}
            disabled={month === currentMonth && selectedDate === today}
          >
            {t.calendar.today}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => goToMonth(addMonths(month, 1))}
            aria-label={t.calendar.nextMonthAria}
          >
            <span className="week-nav-label">{t.calendar.nextMonth}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <StatusLegend />

      <p
        className={`notice week-notice${noticeIsError ? ' notice-error' : ''}`}
        role="status"
        aria-live="polite"
      >
        {notice}
      </p>

      {days === null || loadError ? (
        <CalendarLoadState loadError={loadError} onRetry={reload} />
      ) : (
        <div className="month-layout">
          <div className="month-grid-wrap">
            <div className="month-weekdays" aria-hidden="true">
              {t.calendar.monthWeekdays.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <ol
              ref={gridRef}
              className="month-grid"
              aria-label={t.calendar.monthDaysLabel}
              aria-busy={refreshing}
              onKeyDown={handleGridKeyDown}
            >
              {days.map((day) => (
                <li key={day.date}>
                  <MonthDay
                    day={day}
                    outside={monthOf(day.date) !== month}
                    selected={day.date === selectedDate}
                    tabbable={day.date === focusDate}
                    detailId={detailId}
                    onSelect={() => selectDay(day.date, { scroll: true })}
                  />
                </li>
              ))}
            </ol>
          </div>

          <section
            id={detailId}
            ref={detailRef}
            className="month-detail card"
            aria-labelledby={selectedDay ? `${detailId}-title` : undefined}
            aria-label={selectedDay ? undefined : t.calendar.detailHint}
          >
            {selectedDay ? (
              <DayDetail
                day={selectedDay}
                titleId={`${detailId}-title`}
                onCreate={(event) => open(event, { date: selectedDay.date })}
                onEdit={(event, item) =>
                  open(event, {
                    date: selectedDay.date,
                    activityId: item.activityId,
                    item: selectedDay.isToday ? item : null,
                  })
                }
                onComplete={complete}
                completingId={completingId}
              />
            ) : (
              <p className="muted month-detail-hint">{t.calendar.detailHint}</p>
            )}
          </section>
        </div>
      )}

      {dialog}
    </section>
  );
}

/** Posição do dia na grade (0 = primeira segunda-feira). */
function dayIndex(date, start) {
  return Math.round((Date.parse(date) - Date.parse(start)) / 86_400_000);
}

function dayCounts(day) {
  const total = day.activities.length;
  const done = day.activities.filter((item) => item.status === 'concluida').length;
  return { done, total };
}

function MonthDay({ day, outside, selected, tabbable, detailId, onSelect }) {
  const { done, total } = dayCounts(day);
  const classes = ['month-day'];
  if (outside) classes.push('month-day-outside');
  if (day.isToday) classes.push('month-day-today');
  if (day.isPast) classes.push('month-day-past');
  // Indicador: ✓/✕ no dia concluído/com falha; ponto quando há atividade por fazer
  const icon = DAY_STATUS_ICON[day.status] ?? (total > 0 ? '•' : '');

  return (
    <button
      type="button"
      className={classes.join(' ')}
      data-date={day.date}
      data-status={day.status}
      aria-pressed={selected}
      aria-current={day.isToday ? 'date' : undefined}
      aria-controls={detailId}
      aria-label={t.calendar.monthDayAria({
        day: formatWeekdayDayMonth(day.date),
        isToday: day.isToday,
        status: day.status,
        done,
        total,
      })}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
    >
      <span className="month-day-number" aria-hidden="true">
        {dayOfMonth(day.date)}
      </span>
      {icon && (
        <span className="month-day-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {total > 0 && (
        <span className="month-day-count" aria-hidden="true">
          {t.calendar.dayCount(done, total)}
        </span>
      )}
    </button>
  );
}

function DayDetail({ day, titleId, onCreate, onEdit, onComplete, completingId }) {
  return (
    <>
      <h3 id={titleId} className="week-day-header month-detail-header">
        <span>{formatWeekdayDayMonth(day.date)}</span>
        {day.isToday && <span className="badge week-day-badge">{t.calendar.todayBadge}</span>}
        <DayStatusBadge status={day.status} />
      </h3>
      {day.isPast && <p className="muted month-detail-readonly">{t.calendar.pastReadOnly}</p>}
      {/* Dias passados: só leitura (sem editar nem adicionar) */}
      <DayActivities
        day={day}
        onEdit={day.isPast ? null : onEdit}
        onComplete={onComplete}
        completingId={completingId}
      />
      {!day.isPast && <AddActivityButton date={day.date} onClick={onCreate} />}
    </>
  );
}
