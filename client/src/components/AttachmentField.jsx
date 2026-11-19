import { useId, useRef } from 'react';
import { attachmentUrl, ACCEPT_FILES, formatSize, isPhotoAttachment } from '../lib/attachments.js';
import useMediaQuery from '../lib/useMediaQuery.js';
import t from '../i18n/pt-BR.js';

/** Celular/tablet (toque): mostra também "Tirar foto", que abre a câmera traseira. */
export const TOUCH_QUERY = '(pointer: coarse)';

function PdfBadge() {
  return (
    <span className="attachment-thumb attachment-thumb-pdf" aria-hidden="true">
      PDF
    </span>
  );
}

/**
 * Seção "Anexo" do modal da atividade.
 *
 * - `saved`: anexo já salvo (ou null); `activityId`: dono do anexo salvo
 * - `pending`: arquivo escolhido, ainda não enviado ({ prepared, previewUrl })
 * - `upload`: envio em andamento ({ progress } de 0 a 1), com "Cancelar envio"
 * - `onPick(file)`, `onDiscard()`, `onOpen()`, `onRemove()`, `onCancelUpload()`
 */
export default function AttachmentField({
  saved,
  activityId,
  pending,
  preparing,
  upload,
  error,
  notice,
  disabled,
  onPick,
  onDiscard,
  onOpen,
  onRemove,
  onCancelUpload,
}) {
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const titleId = useId();
  const hintId = useId();
  const errorId = useId();
  const isTouch = useMediaQuery(TOUCH_QUERY);

  function handleChange(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (file) onPick(file);
  }

  const busy = disabled || preparing || Boolean(upload);
  const pct = upload ? Math.round(upload.progress * 100) : 0;

  return (
    <section
      className="field attachment-field"
      aria-labelledby={titleId}
      aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(' ')}
    >
      <h3 id={titleId} className="field-label">
        {t.attachment.title}
      </h3>

      {saved && !pending && (
        <div className="attachment-card">
          {isPhotoAttachment(saved) ? (
            <img
              className="attachment-thumb"
              src={attachmentUrl(activityId, saved)}
              alt={t.attachment.thumbAlt(saved.originalName)}
            />
          ) : (
            <PdfBadge />
          )}
          <span className="attachment-info">
            <span className="attachment-name" title={saved.originalName}>
              {saved.originalName}
            </span>
            <span className="attachment-meta muted">
              {isPhotoAttachment(saved) ? t.attachment.photo : t.attachment.pdf} ·{' '}
              {formatSize(saved.size)}
            </span>
          </span>
          <span className="attachment-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={onOpen}
              disabled={busy}
              aria-label={t.attachment.openAria(saved.originalName)}
            >
              {t.attachment.open}
            </button>
            <button
              type="button"
              className="button button-ghost button-ghost-danger"
              onClick={onRemove}
              disabled={busy}
              aria-label={t.attachment.removeAria(saved.originalName)}
            >
              {t.attachment.remove}
            </button>
          </span>
        </div>
      )}

      {pending && (
        <div className="attachment-card attachment-card-pending">
          {pending.prepared.isPhoto ? (
            <img
              className="attachment-thumb attachment-preview"
              src={pending.previewUrl}
              alt={t.attachment.previewAlt(pending.prepared.name)}
            />
          ) : (
            <PdfBadge />
          )}
          <span className="attachment-info">
            <span className="attachment-name" title={pending.prepared.name}>
              {pending.prepared.name}
            </span>
            <span className="attachment-meta muted">
              {formatSize(pending.prepared.blob.size)} ·{' '}
              {saved ? t.attachment.pendingReplace : t.attachment.pendingNew}
            </span>
          </span>
          {!upload && (
            <span className="attachment-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={onDiscard}
                disabled={busy}
                aria-label={t.attachment.discardAria(pending.prepared.name)}
              >
                {t.attachment.discard}
              </button>
            </span>
          )}
        </div>
      )}

      {upload && (
        <div className="attachment-upload">
          <label className="attachment-progress-label">
            <span aria-hidden="true">{t.attachment.uploading(pct)}</span>
            <progress
              className="attachment-progress"
              max="100"
              value={pct}
              aria-label={t.attachment.progressLabel}
            />
          </label>
          <button type="button" className="button button-ghost" onClick={onCancelUpload}>
            {t.attachment.cancelUpload}
          </button>
        </div>
      )}

      {preparing && (
        <div className="inline-loading" role="status">
          <span className="spinner spinner-small" aria-hidden="true" />
          <span>{t.attachment.preparing}</span>
        </div>
      )}

      {!upload && (
        <div className="attachment-pick">
          {isTouch && (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => cameraRef.current?.click()}
              disabled={busy}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="attachment-icon">
                <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              {t.attachment.takePhoto}
            </button>
          )}
          <button
            type="button"
            className="button button-ghost"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="attachment-icon">
              <path d="M15.5 7.5l-6.4 6.4a1.8 1.8 0 002.5 2.5l6.8-6.8a3.5 3.5 0 00-5-5l-7 7a5.2 5.2 0 007.4 7.4l5.7-5.7" />
            </svg>
            {saved || pending ? t.attachment.replaceFile : t.attachment.chooseFile}
          </button>
          {/* Câmera traseira (no desktop o atributo capture é ignorado) */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="attachment-camera-input"
            onChange={handleChange}
          />
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_FILES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="attachment-file-input"
            onChange={handleChange}
          />
        </div>
      )}

      <span id={hintId} className="field-hint">
        {t.attachment.hint}
      </span>
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
      {notice && (
        <span className="field-hint attachment-notice" role="status">
          {notice}
        </span>
      )}
    </section>
  );
}
