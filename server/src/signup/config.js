// Modo do cadastro, definido em server/.env (SIGNUP_MODE):
//  - aprovacao (padrão): a conta aguarda o master aprovar na página Usuários
//  - aberto:             a conta é liberada logo após confirmar o telefone
//  - desligado:          não há cadastro; só o master cria usuários
export const SIGNUP_MODES = ['aprovacao', 'aberto', 'desligado'];
const DEFAULT_MODE = 'aprovacao';

let warned = false;

/** Lido a cada requisição (mudar o .env exige reiniciar o servidor, mas os testes trocam). */
export function signupMode() {
  const raw = (process.env.SIGNUP_MODE || '').trim().toLowerCase();
  if (!raw) return DEFAULT_MODE;
  if (SIGNUP_MODES.includes(raw)) return raw;
  if (!warned) {
    warned = true;
    console.warn(`SIGNUP_MODE="${raw}" inválido; usando "${DEFAULT_MODE}".`);
  }
  return DEFAULT_MODE;
}
