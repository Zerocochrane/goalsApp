import t from '../i18n/pt-BR.js';

/** Mensagem para o usuário a partir de um ApiError. */
export function apiErrorMessage(err) {
  if ([0, 502, 503, 504].includes(err?.status)) return t.errors.network;
  if (err?.status === 403) return t.errors.forbidden;
  if ([400, 404, 409].includes(err?.status) && err.message) return err.message;
  return t.errors.generic;
}

/** Erros por campo devolvidos pela API ({ fields: { campo: mensagem } }). */
export function apiFieldErrors(err) {
  return err?.data?.fields ?? {};
}
