import t from '../i18n/pt-BR.js';

export default function FullPageLoading() {
  return (
    <div className="full-page-center" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{t.app.loading}</span>
    </div>
  );
}
