// Validação dos campos de usuário. Cada função devolve { value } ou { error }.

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72; // limite do bcrypt
export const NAME_MAX = 80;

// DDDs válidos no Brasil (Anatel)
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Telefone WhatsApp brasileiro com DDI 55. Aceita máscara (+55 (32) 99999-9999)
 * e devolve em E.164: +55DDNNNNNNNNN. Vazio → null (sem telefone).
 * Celular: 9 dígitos começando com 9. Também aceita 8 dígitos (contas de WhatsApp
 * antigas, registradas antes do nono dígito).
 */
export function parsePhone(input) {
  if (input === undefined || input === null) return { value: null };
  if (typeof input !== 'string') return { error: 'Telefone inválido' };
  const trimmed = input.trim();
  if (!trimmed) return { value: null };
  if (!/^[+\d\s().-]+$/.test(trimmed)) return { error: 'Telefone inválido' };

  const digits = trimmed.replace(/\D/g, '');
  const match = /^55(\d{2})(\d{8,9})$/.exec(digits);
  if (!match) {
    return {
      error: 'Telefone deve estar no formato brasileiro com DDI 55: +55 (DDD) 9XXXX-XXXX',
    };
  }
  const [, ddd, number] = match;
  if (!DDDS.has(Number(ddd))) return { error: 'DDD inválido' };
  if (number.length === 9 && number[0] !== '9') {
    return { error: 'Celular com 9 dígitos deve começar com 9' };
  }
  if (number.length === 8 && !/^[6-9]/.test(number)) {
    return { error: 'Número de celular inválido' };
  }
  return { value: `+${digits}` };
}

export function parseName(input) {
  if (typeof input !== 'string' || !input.trim()) return { error: 'Informe o nome' };
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length > NAME_MAX) return { error: `Nome deve ter no máximo ${NAME_MAX} caracteres` };
  return { value };
}

export function parseUsername(input) {
  if (typeof input !== 'string' || !input.trim()) return { error: 'Informe o usuário' };
  const value = input.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(value)) {
    return {
      error: 'Usuário deve ter de 3 a 32 caracteres: letras sem acento, números, ponto, - ou _',
    };
  }
  return { value };
}

export function parsePassword(input) {
  if (typeof input !== 'string' || !input) return { error: 'Informe a senha' };
  if (input.length < PASSWORD_MIN) {
    return { error: `Senha deve ter pelo menos ${PASSWORD_MIN} caracteres` };
  }
  if (Buffer.byteLength(input, 'utf8') > PASSWORD_MAX) return { error: 'Senha muito longa' };
  return { value: input };
}
