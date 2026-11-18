import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Hash fixo usado quando o usuário não existe, para o tempo de resposta
// não revelar quais usuários existem.
const DUMMY_HASH = bcrypt.hashSync('usuario-inexistente', ROUNDS);
export function burnPasswordCheck(password) {
  return bcrypt.compare(password, DUMMY_HASH);
}
