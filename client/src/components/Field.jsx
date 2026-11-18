import { useId } from 'react';

/** Campo de formulário com rótulo, dica e erro ligados ao input por aria-*. */
export default function Field({ label, hint, error, className = '', ...inputProps }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        aria-invalid={Boolean(error)}
        aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        {...inputProps}
      />
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
