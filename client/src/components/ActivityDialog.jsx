import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';
import Field from './Field.jsx';
import { api } from '../lib/api.js';
import { formatWeekdayDayMonth, todayInSaoPaulo, weekdayOf } from '../lib/dates.js';
import { apiErrorMessage, apiFieldErrors } from '../lib/errors.js';
import useMediaQuery, { SHEET_QUERY } from '../lib/useMediaQuery.js';
import t from '../i18n/pt-BR.js';

export const ACTIVITY_NAME_MAX = 80;

/** Ordem de exibição: segunda a domingo (valores 0–6, 0 = domingo, como na API). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Valida o formulário; devolve { campo: mensagem } (vazio = válido). */
function validate({ name, time, weekdays }) {
  const errors = {};
  const trimmed = name.trim();
  if (!trimmed) errors.name = t.activity.nameRequired;
  else if (trimmed.length > ACTIVITY_NAME_MAX)
    errors.name = t.activity.nameTooLong(ACTIVITY_NAME_MAX);
  if (!/^\d{2}:\d{2}$/.test(time)) errors.time = t.activity.timeRequired;
  if (weekdays.length === 0) errors.weekdays = t.activity.weekdaysRequired;
  return errors;
}

/**
 * Modal "Nova atividade" / "Editar atividade".
 *
 * - Criação: `date` é o dia clicado; ele vem marcado nos dias da semana e é o início
 *   da recorrência.
 * - Edição: `activityId` é carregado de GET /api/activities/:id e pode ser excluído.
 *
 * Usa <dialog>.showModal(): o resto da página fica inerte (foco preso) e Esc fecha.
 * `onDone(mensagem)` é chamado depois de salvar/excluir; `onClose()` ao cancelar.
 */
export default function ActivityDialog({ date, activityId = null, onClose, onDone }) {
  const isEdit = activityId !== null;
  const ref = useRef(null);
  const nameRef = useRef(null);
  const timeRef = useRef(null);
  const weekdaysRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const weekdaysErrorId = useId();

  const [form, setForm] = useState(() => ({
    name: '',
    time: '',
    weekdays: isEdit ? [] : [weekdayOf(date)],
  }));
  const [loadState, setLoadState] = useState(isEdit ? 'loading' : 'ready');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState('');

  // Abre como modal ao montar e fecha antes de sair do DOM
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Foco inicial no nome (na edição, quando os dados chegarem)
  useEffect(() => {
    if (loadState === 'ready') nameRef.current?.focus();
  }, [loadState]);

  useEffect(() => {
    if (!isEdit) return undefined;
    let ignore = false;
    api(`/activities/${activityId}`)
      .then(({ activity }) => {
        if (ignore) return;
        setForm({
          name: activity.name,
          time: `${pad(activity.hour)}:${pad(activity.minute)}`,
          weekdays: activity.weekdays,
        });
        setLoadState('ready');
      })
      .catch((err) => {
        if (ignore) return;
        setFormError(err?.status === 404 ? apiErrorMessage(err) : t.activity.loadError);
        setLoadState('error');
      });
    return () => {
      ignore = true;
    };
  }, [isEdit, activityId]);

  const isPastDay = !isEdit && date < todayInSaoPaulo();

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function toggleWeekday(day, checked) {
    const next = checked ? [...form.weekdays, day] : form.weekdays.filter((d) => d !== day);
    update('weekdays', next);
  }

  function focusFirstError(errs) {
    if (errs.name) nameRef.current?.focus();
    else if (errs.time) timeRef.current?.focus();
    else if (errs.weekdays) weekdaysRef.current?.querySelector('input')?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || loadState !== 'ready') return;
    setFormError('');

    if (isPastDay) {
      setFormError(t.activity.pastDay);
      return;
    }
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusFirstError(errs);
      return;
    }

    const [hour, minute] = form.time.split(':').map(Number);
    const body = { name: form.name.trim(), hour, minute, weekdays: form.weekdays };
    setBusy(true);
    try {
      const { activity } = isEdit
        ? await api(`/activities/${activityId}`, { method: 'PUT', body })
        : await api('/activities', { method: 'POST', body: { ...body, startDate: date } });
      onDone(isEdit ? t.activity.updated(activity.name) : t.activity.created(activity.name));
    } catch (err) {
      const fieldErrors = apiFieldErrors(err);
      const mapped = {
        name: fieldErrors.name,
        time: fieldErrors.hour || fieldErrors.minute,
        weekdays: fieldErrors.weekdays,
      };
      if (mapped.name || mapped.time || mapped.weekdays) {
        setErrors(mapped);
        focusFirstError(mapped);
      }
      setFormError(fieldErrors.startDate || apiErrorMessage(err));
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setRemoveError('');
    try {
      await api(`/activities/${activityId}`, { method: 'DELETE' });
      onDone(t.activity.removed(form.name));
    } catch (err) {
      setRemoveError(apiErrorMessage(err));
      setBusy(false);
    }
  }

  const disabled = busy || loadState !== 'ready';
  // Celular (bottom sheet): "Excluir" sai do rodapé fixo e fica afastado, abaixo dele
  const isSheet = useMediaQuery(SHEET_QUERY);

  const removeButton = isEdit && loadState === 'ready' && (
    <button
      type="button"
      className="button button-ghost button-ghost-danger activity-remove"
      onClick={() => {
        setRemoveError('');
        setConfirmOpen(true);
      }}
      disabled={busy}
    >
      {t.activity.remove}
    </button>
  );

  return (
    <>
      <dialog
        ref={ref}
        className="dialog activity-dialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={loadState === 'loading'}
        onCancel={(e) => {
          e.preventDefault(); // Esc: quem fecha é o pai
          if (!busy && !confirmOpen) onClose();
        }}
      >
        <form onSubmit={handleSubmit} noValidate>
          <div className="activity-dialog-header">
            <h2 id={titleId} className="dialog-title">
              {isEdit ? t.activity.editTitle : t.activity.createTitle}
            </h2>
            <button
              type="button"
              className="button button-ghost button-icon"
              onClick={onClose}
              disabled={busy}
              aria-label={t.activity.close}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <p id={descId} className="muted activity-dialog-desc">
            {isEdit ? t.activity.editStartsOn : t.activity.startsOn(formatWeekdayDayMonth(date))}
          </p>

          {loadState === 'loading' ? (
            <div className="inline-loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>{t.activity.loading}</span>
            </div>
          ) : loadState === 'ready' ? (
            <>
              <Field
                ref={nameRef}
                label={t.activity.name}
                placeholder={t.activity.namePlaceholder}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                error={errors.name}
                maxLength={ACTIVITY_NAME_MAX}
                autoComplete="off"
                required
                disabled={busy}
              />
              <Field
                ref={timeRef}
                type="time"
                label={t.activity.time}
                hint={t.activity.timeHint}
                value={form.time}
                onChange={(e) => update('time', e.target.value)}
                error={errors.time}
                className="activity-time-field"
                required
                disabled={busy}
              />
              <fieldset
                ref={weekdaysRef}
                className="field weekday-fieldset"
                aria-invalid={Boolean(errors.weekdays)}
                aria-describedby={errors.weekdays ? weekdaysErrorId : undefined}
                disabled={busy}
              >
                <legend className="field-label">{t.activity.weekdays}</legend>
                <div className="weekday-options">
                  {WEEKDAY_ORDER.map((day) => (
                    <label key={day} className="weekday-option">
                      <input
                        type="checkbox"
                        checked={form.weekdays.includes(day)}
                        onChange={(e) => toggleWeekday(day, e.target.checked)}
                        aria-label={t.activity.weekdayLong[day]}
                      />
                      <span aria-hidden="true">{t.activity.weekdayShort[day]}</span>
                    </label>
                  ))}
                </div>
                {errors.weekdays && (
                  <span id={weekdaysErrorId} className="field-error">
                    {errors.weekdays}
                  </span>
                )}
              </fieldset>
            </>
          ) : null}

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="dialog-actions activity-dialog-actions">
            {!isSheet && removeButton}
            <button type="button" className="button button-ghost" onClick={onClose} disabled={busy}>
              {t.activity.cancel}
            </button>
            {loadState !== 'error' && (
              <button type="submit" className="button button-primary" disabled={disabled}>
                {busy && !confirmOpen && (
                  <span className="spinner spinner-small" aria-hidden="true" />
                )}
                {busy && !confirmOpen ? t.activity.saving : t.activity.save}
              </button>
            )}
          </div>
          {isSheet && removeButton && <div className="activity-remove-zone">{removeButton}</div>}
        </form>
      </dialog>

      {/* Fora do <dialog> principal: o Esc da confirmação não fecha o formulário */}
      {isEdit && (
        <ConfirmDialog
          open={confirmOpen}
          title={t.activity.confirmTitle}
          confirmLabel={t.activity.confirmYes}
          busyLabel={t.activity.confirmBusy}
          busy={busy}
          error={removeError}
          onConfirm={handleRemove}
          onCancel={() => setConfirmOpen(false)}
        >
          {t.activity.confirmText(form.name)}
        </ConfirmDialog>
      )}
    </>
  );
}
