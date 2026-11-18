import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
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
import useMediaQuery from '../lib/useMediaQuery.js';
import t from '../i18n/pt-BR.js';

// Atualização automática: a cada 60s com a aba visível e ao voltar para a aba
const POLL_INTERVAL_MS = 60_000;

// Ícone de cada status (a cor nunca é o único indicador)
const STATUS_ICON = { concluida: '✓', falhou: '✕', pendente: '○' };
const DAY_STATUS_ICON = { concluido: '✓', falhou: '✕' };

// Celular e tablet: dias empilhados (mesmo ponto de quebra do CSS)
const STACKED_QUERY = '(max-width: 839px)';
const WEEK_PARAM = 'semana';

/** Segunda-feira da semana em `?semana=AAAA-MM-DD`, ou null se ausente/inválida. */
function weekFromParam(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  // Rejeita datas impossíveis (ex.: 2026-02-31), que o Date "corrigiria"
  if (addDays(value, 0) !== value) return null;
  return startOfWeek(value);
}

/** Calendário da semana (segunda a domingo), consumindo GET /api/calendar. */
export default function WeekCalendar() {
  // Semana na URL (?semana=…) para o botão voltar e links funcionarem; sem o
  // parâmetro, a semana atual
  const [searchParams, setSearchParams] = useSearchParams();
  const currentWeekStart = startOfWeek(todayInSaoPaulo());
  const weekStart = weekFromParam(searchParams.get(WEEK_PARAM)) ?? currentWeekStart;
  const stacked = useMediaQuery(STACKED_QUERY);
  // Dias passados (semana atual, celular) que o usuário expandiu
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  // Rola até o card de hoje só na primeira carga (navegar entre semanas não rola)
  const autoScrollRef = useRef(true);
  const toolbarRef = useRef(null);
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
                onCreate={(event) => openDialog(event, { date: day.date })}
                onEdit={(event, item) =>
                  openDialog(event, { date: day.date, activityId: item.activityId })
                }
              />
            );
          })}
        </ol>
      )}

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
      {DAY_STATUS_ICON[day.status] && (
        <span className={`badge day-status day-status-${day.status}`}>
          <span aria-hidden="true">{DAY_STATUS_ICON[day.status]}</span>
          {t.calendar.dayStatus[day.status]}
        </span>
      )}
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
      </div>

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
