// Telefone WhatsApp: a API guarda em E.164 (+5532999999999).

/** +5532999999999 → +55 (32) 99999-9999 */
export function formatPhone(phone) {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phone || '');
  if (!match) return phone || '';
  const [, ddd, first, last] = match;
  return `+55 (${ddd}) ${first}-${last}`;
}
