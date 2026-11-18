import { useEffect, useId, useRef } from 'react';
import t from '../i18n/pt-BR.js';

/** Diálogo modal de confirmação (usa <dialog>: foco preso e Esc fecham nativamente). */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  error = '',
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(e) => {
        e.preventDefault(); // Esc: quem fecha é o pai (mantém o estado em sincronia)
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      <p id={textId}>{children}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={busy}>
          {t.users.cancel}
        </button>
        <button type="button" className="button button-danger" onClick={onConfirm} disabled={busy}>
          {busy && <span className="spinner spinner-small" aria-hidden="true" />}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
