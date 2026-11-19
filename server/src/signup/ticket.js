// "Ticket" do cadastro: liga a tela do código ao usuário recém-criado, que ainda não
// pode ter sessão. É um JWT assinado com um segredo derivado do JWT_SECRET, então
// nunca vale como cookie de login (e vice-versa).
import jwt from 'jsonwebtoken';

const TICKET_TTL_S = 60 * 60; // 1 hora; depois disso, entrar com usuário e senha gera outro

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET não definido em server/.env');
  return `${value}:signup-ticket`;
}

export function createTicket(user) {
  return jwt.sign({ sub: String(user.id), p: 'signup' }, secret(), {
    algorithm: 'HS256',
    expiresIn: TICKET_TTL_S,
  });
}

/** Id do usuário do ticket, ou null se ausente/inválido/expirado. */
export function readTicket(token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    const userId = Number(payload.sub);
    if (payload.p !== 'signup' || !Number.isSafeInteger(userId) || userId <= 0) return null;
    return userId;
  } catch {
    return null;
  }
}
