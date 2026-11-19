import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import AttachmentField from './AttachmentField.jsx';
import AttachmentViewer from './AttachmentViewer.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import Field from './Field.jsx';
import { AttachmentError, prepareFile, uploadAttachment } from '../lib/attachments.js';
import { parseHttpsUrl, videoEmbed } from '../lib/video.js';
import { api } from '../lib/api.js';
import { STATUS_ICON } from '../lib/calendarStatus.js';
import { completeActivity } from '../lib/completeActivity.js';
import { completionState, useServerNow } from '../lib/serverClock.js';
import { formatWeekdayDayMonth, todayInSaoPaulo, weekdayOf } from '../lib/dates.js';
import { apiErrorMessage, apiFieldErrors } from '../lib/errors.js';
import useMediaQuery, { SHEET_QUERY } from '../lib/useMediaQuery.js';
import t from '../i18n/pt-BR.js';

export const ACTIVITY_NAME_MAX = 80;
export const DESCRIPTION_MAX = 1000;

/** Ordem de exibição: segunda a domingo (valores 0–6, 0 = domingo, como na API). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Valida o formulário; devolve { campo: mensagem } (vazio = válido). */
function validate({ name, time, weekdays, description, videoUrl }) {
  const errors = {};
  const trimmed = name.trim();
  if (!trimmed) errors.name = t.activity.nameRequired;
  else if (trimmed.length > ACTIVITY_NAME_MAX)
    errors.name = t.activity.nameTooLong(ACTIVITY_NAME_MAX);
  if (!/^\d{2}:\d{2}$/.test(time)) errors.time = t.activity.timeRequired;
  if (weekdays.length === 0) errors.weekdays = t.activity.weekdaysRequired;
  if (normalizeDescription(description).length > DESCRIPTION_MAX)
    errors.description = t.activity.descriptionTooLong(DESCRIPTION_MAX);
  if (videoUrl.trim() && !parseHttpsUrl(videoUrl)) errors.videoUrl = t.activity.videoInvalid;
  return errors;
}

/** Igual ao servidor: quebras de linha \n, sem espaços nas pontas. */
function normalizeDescription(text) {
  return text.replace(/\r\n?/g, '\n').trim();
}

/** Mensagem de erro do envio do anexo (o servidor já manda o texto certo). */
function uploadErrorMessage(err) {
  if (err?.status && err.status !== 401 && err.message && err.status < 500) return err.message;
  return apiErrorMessage(err);
}

/**
 * Modal "Nova atividade" / "Editar atividade".
 *
 * - Criação: `date` é o dia clicado; ele vem marcado nos dias da semana e é o início
 *   da recorrência.
 * - Edição: `activityId` é carregado de GET /api/activities/:id e pode ser excluído.
 * - Atividade de hoje (`item` do calendário): mostra o status e "Concluir atividade",
 *   que se habilita sozinho no horário e some ao fim do prazo (relógio do servidor).
 *
 * Usa <dialog>.showModal(): o resto da página fica inerte (foco preso) e Esc fecha.
 * `onDone(mensagem)` é chamado depois de salvar/excluir/concluir; `onClose()` ao cancelar;
 * `onChanged()` quando a conclusão foi recusada (o calendário recarrega o status).
 */
export default function ActivityDialog({
  date,
  activityId = null,
  item = null,
  onClose,
  onDone,
  onChanged,
}) {
  const isEdit = activityId !== null;
  const ref = useRef(null);
  const nameRef = useRef(null);
  const timeRef = useRef(null);
  const weekdaysRef = useRef(null);
  const descriptionRef = useRef(null);
  const videoRef = useRef(null);
  const completeRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const weekdaysErrorId = useId();
  const descriptionId = useId();

  const [form, setForm] = useState(() => ({
    name: '',
    time: '',
    weekdays: isEdit ? [] : [weekdayOf(date)],
    description: '',
    videoUrl: '',
  }));
  // Id da atividade salva: começa no editado e muda quando a edição cria nova versão
  // (ou quando a criação deu certo mas o anexo falhou — "Salvar" de novo só reenvia)
  const [savedId, setSavedId] = useState(activityId);
  // Algo já foi salvo neste modal (mensagem): ao fechar, o calendário recarrega
  const changedRef = useRef(null);
  // Anexo: o salvo, o escolhido (ainda não enviado) e o envio em andamento
  const [attachment, setAttachment] = useState(null);
  const [pending, setPending] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [upload, setUpload] = useState(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const [replaceCandidate, setReplaceCandidate] = useState(null);
  const [removeAttachmentOpen, setRemoveAttachmentOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const abortRef = useRef(null);
  const [loadState, setLoadState] = useState(isEdit ? 'loading' : 'ready');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState('');
  // Concluir pelo site: só para a atividade de hoje, pelo relógio do servidor
  const now = useServerNow(Boolean(item?.disponivelEm));
  const completion = completionState(item, now);
  // Dentro do prazo ao abrir: o foco vai para "Concluir" (não abre o teclado no celular)
  const focusCompleteRef = useRef(completion?.phase === 'open');

  // Abre como modal ao montar e fecha antes de sair do DOM
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Foco inicial no nome (na edição, quando os dados chegarem)
  useEffect(() => {
    if (loadState !== 'ready') return;
    if (focusCompleteRef.current && completeRef.current) completeRef.current.focus();
    else nameRef.current?.focus();
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
          description: activity.description ?? '',
          videoUrl: activity.videoUrl ?? '',
        });
        setAttachment(activity.attachment ?? null);
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

  // Prévia da foto escolhida: libera a URL temporária ao trocar/descartar/fechar
  useEffect(() => {
    const url = pending?.previewUrl;
    return () => url && URL.revokeObjectURL(url);
  }, [pending]);

  // Fechar o modal no meio do envio cancela o envio
  useEffect(() => () => abortRef.current?.(), []);

  const isPastDay = savedId === null && date < todayInSaoPaulo();

  /** Fechar: se algo já foi salvo aqui, o calendário recarrega (como depois de salvar). */
  function handleClose() {
    if (changedRef.current) onDone(changedRef.current);
    else onClose();
  }

  async function pickFile(file) {
    setAttachmentError('');
    setAttachmentNotice('');
    setPreparing(true);
    try {
      const prepared = await prepareFile(file);
      const next = {
        prepared,
        previewUrl: prepared.isPhoto ? URL.createObjectURL(prepared.blob) : null,
      };
      // Já existe anexo salvo: confirma a substituição
      if (attachment) setReplaceCandidate(next);
      else setPending(next);
    } catch (err) {
      setAttachmentError(err instanceof AttachmentError ? err.message : t.attachment.invalid);
    } finally {
      setPreparing(false);
    }
  }

  async function removeAttachment() {
    setBusy(true);
    setRemoveError('');
    try {
      await api(`/activities/${savedId}/attachment`, { method: 'DELETE' });
      setAttachment(null);
      setAttachmentNotice(t.attachment.removed);
      changedRef.current ??= t.attachment.removed;
      setRemoveAttachmentOpen(false);
    } catch (err) {
      setRemoveError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

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
    else if (errs.description) descriptionRef.current?.focus();
    else if (errs.videoUrl) videoRef.current?.focus();
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
    const body = {
      name: form.name.trim(),
      hour,
      minute,
      weekdays: form.weekdays,
      description: normalizeDescription(form.description) || null,
      videoUrl: form.videoUrl.trim() || null,
    };
    setBusy(true);
    let activity;
    try {
      ({ activity } =
        savedId !== null
          ? await api(`/activities/${savedId}`, { method: 'PUT', body })
          : await api('/activities', { method: 'POST', body: { ...body, startDate: date } }));
    } catch (err) {
      const fieldErrors = apiFieldErrors(err);
      const mapped = {
        name: fieldErrors.name,
        time: fieldErrors.hour || fieldErrors.minute,
        weekdays: fieldErrors.weekdays,
        description: fieldErrors.description,
        videoUrl: fieldErrors.videoUrl,
      };
      if (Object.values(mapped).some(Boolean)) {
        setErrors(mapped);
        focusFirstError(mapped);
      }
      setFormError(fieldErrors.startDate || apiErrorMessage(err));
      setBusy(false);
      return;
    }

    const message =
      isEdit || changedRef.current
        ? t.activity.updated(activity.name)
        : t.activity.created(activity.name);
    changedRef.current = message;
    setSavedId(activity.id);
    setAttachment(activity.attachment ?? null);
    if (!pending) {
      onDone(message);
      return;
    }

    // Anexo escolhido: envia agora, com progresso (a atividade já está salva)
    setFormError('');
    setUpload({ progress: 0 });
    const { promise, abort } = uploadAttachment(activity.id, pending.prepared, (progress) =>
      setUpload({ progress }),
    );
    abortRef.current = abort;
    try {
      await promise;
      abortRef.current = null;
      onDone(message);
    } catch (err) {
      abortRef.current = null;
      setUpload(null);
      setBusy(false);
      if (err.message === 'abort') setAttachmentNotice(t.attachment.uploadCanceled);
      else setFormError(t.activity.savedButAttachmentFailed(uploadErrorMessage(err)));
    }
  }

  async function handleComplete() {
    if (busy) return;
    setBusy(true);
    setCompleting(true);
    setCompleteError('');
    const { ok, message } = await completeActivity(item.activityId);
    if (ok) {
      onDone(message);
      return;
    }
    setCompleteError(message);
    setCompleting(false);
    setBusy(false);
    onChanged?.();
  }

  async function handleRemove() {
    setBusy(true);
    setRemoveError('');
    try {
      await api(`/activities/${savedId}`, { method: 'DELETE' });
      onDone(t.activity.removed(form.name));
    } catch (err) {
      setRemoveError(apiErrorMessage(err));
      setBusy(false);
    }
  }

  const disabled = busy || loadState !== 'ready';
  // Celular (bottom sheet): "Excluir" sai do rodapé fixo e fica afastado, abaixo dele
  const isSheet = useMediaQuery(SHEET_QUERY);

  const removeButton = savedId !== null && loadState === 'ready' && (
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
          if (!busy && !confirmOpen) handleClose();
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
              onClick={handleClose}
              disabled={busy}
              aria-label={t.activity.close}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <p id={descId} className="muted activity-dialog-desc">
            {isEdit ? t.activity.editStartsOn : t.activity.startsOn(formatWeekdayDayMonth(date))}
          </p>

          {item && (
            <section className="activity-complete" aria-label={t.calendar.statusLabel}>
              <p className="activity-complete-status" data-status={item.status}>
                <span className="status-icon" aria-hidden="true">
                  {STATUS_ICON[item.status]}
                </span>
                <span>
                  {t.calendar.statusLabel}:{' '}
                  <strong>{t.calendar.activityStatus[item.status]}</strong>
                </span>
              </p>
              {completion && (
                <div className="activity-complete-action">
                  <button
                    ref={completeRef}
                    type="button"
                    className="button button-primary activity-complete-button"
                    onClick={handleComplete}
                    disabled={busy || completion.phase !== 'open'}
                  >
                    {completing && <span className="spinner spinner-small" aria-hidden="true" />}
                    {completing
                      ? t.calendar.completing
                      : completion.phase === 'open'
                        ? t.calendar.complete
                        : t.calendar.availableAt(completion.from)}
                  </button>
                  {completion.phase === 'open' && (
                    <span className="activity-complete-left">
                      {t.calendar.timeLeft(completion.minutesLeft)}
                    </span>
                  )}
                </div>
              )}
              {completeError && (
                <p className="form-error" role="alert">
                  {completeError}
                </p>
              )}
            </section>
          )}

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

              <div className="field">
                <span className="field-label-row">
                  <label className="field-label" htmlFor={descriptionId}>
                    {t.activity.description}
                  </label>
                  <span
                    className="field-counter"
                    data-over={form.description.length > DESCRIPTION_MAX || undefined}
                    aria-hidden="true"
                  >
                    {t.activity.descriptionCounter(form.description.length, DESCRIPTION_MAX)}
                  </span>
                </span>
                <textarea
                  ref={descriptionRef}
                  id={descriptionId}
                  className="input activity-description"
                  rows={4}
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  maxLength={DESCRIPTION_MAX}
                  aria-invalid={Boolean(errors.description)}
                  aria-describedby={[
                    errors.description ? `${descriptionId}-error` : null,
                    `${descriptionId}-hint`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={busy}
                />
                {errors.description && (
                  <span id={`${descriptionId}-error`} className="field-error">
                    {errors.description}
                  </span>
                )}
                <span id={`${descriptionId}-hint`} className="field-hint">
                  {t.activity.descriptionHint}{' '}
                  <span className="sr-only">
                    {t.activity.descriptionCounter(form.description.length, DESCRIPTION_MAX)}
                  </span>
                </span>
              </div>

              <Field
                ref={videoRef}
                type="url"
                inputMode="url"
                label={t.activity.video}
                placeholder={t.activity.videoPlaceholder}
                hint={t.activity.videoHint}
                value={form.videoUrl}
                onChange={(e) => update('videoUrl', e.target.value)}
                error={errors.videoUrl}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              <VideoPreview url={form.videoUrl} name={form.name} />

              <AttachmentField
                saved={attachment}
                activityId={savedId}
                pending={pending}
                preparing={preparing}
                upload={upload}
                error={attachmentError}
                notice={attachmentNotice}
                disabled={busy}
                onPick={pickFile}
                onDiscard={() => setPending(null)}
                onOpen={() => setViewerOpen(true)}
                onRemove={() => {
                  setRemoveError('');
                  setRemoveAttachmentOpen(true);
                }}
                onCancelUpload={() => abortRef.current?.()}
              />
            </>
          ) : null}

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="dialog-actions activity-dialog-actions">
            {!isSheet && removeButton}
            <button
              type="button"
              className="button button-ghost"
              onClick={handleClose}
              disabled={busy}
            >
              {t.activity.cancel}
            </button>
            {loadState !== 'error' && (
              <button type="submit" className="button button-primary" disabled={disabled}>
                {busy && !confirmOpen && !completing && !removeAttachmentOpen && (
                  <span className="spinner spinner-small" aria-hidden="true" />
                )}
                {busy && !confirmOpen && !completing && !removeAttachmentOpen
                  ? t.activity.saving
                  : t.activity.save}
              </button>
            )}
          </div>
          {isSheet && removeButton && <div className="activity-remove-zone">{removeButton}</div>}
        </form>
      </dialog>

      {/* Fora do <dialog> principal: o Esc da confirmação não fecha o formulário */}
      <ConfirmDialog
        open={replaceCandidate !== null}
        title={t.attachment.replaceTitle}
        confirmLabel={t.attachment.replaceYes}
        busyLabel={t.attachment.replaceYes}
        onConfirm={() => {
          setPending(replaceCandidate);
          setReplaceCandidate(null);
        }}
        onCancel={() => {
          if (replaceCandidate?.previewUrl) URL.revokeObjectURL(replaceCandidate.previewUrl);
          setReplaceCandidate(null);
        }}
      >
        {attachment &&
          replaceCandidate &&
          t.attachment.replaceText(attachment.originalName, replaceCandidate.prepared.name)}
      </ConfirmDialog>
      <ConfirmDialog
        open={removeAttachmentOpen}
        title={t.attachment.removeTitle}
        confirmLabel={t.attachment.removeYes}
        busyLabel={t.attachment.removeBusy}
        busy={busy}
        error={removeError}
        onConfirm={removeAttachment}
        onCancel={() => setRemoveAttachmentOpen(false)}
      >
        {attachment && t.attachment.removeText(attachment.originalName)}
      </ConfirmDialog>
      {viewerOpen && attachment && (
        <AttachmentViewer
          activityId={savedId}
          attachment={attachment}
          onClose={() => setViewerOpen(false)}
        />
      )}
      {savedId !== null && (
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

/** Player do YouTube/Vimeo, ou botão "Abrir vídeo" para outros links https://. */
function VideoPreview({ url, name }) {
  const valid = parseHttpsUrl(url);
  if (!valid) return null;
  const embed = videoEmbed(url);
  if (!embed) {
    return (
      <p className="video-link">
        <a
          className="button button-ghost"
          href={valid.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.activity.openVideoAria}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="attachment-icon">
            <path d="M10.5 8.5v7l6-3.5z" />
            <rect x="3" y="4" width="18" height="16" rx="3" />
          </svg>
          {t.activity.openVideo}
        </a>
      </p>
    );
  }
  return (
    <div className="video-embed">
      <iframe
        src={embed.src}
        title={t.activity.videoTitle(embed.provider, name.trim() || t.activity.video)}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
