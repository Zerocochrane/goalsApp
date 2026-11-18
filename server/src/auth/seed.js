import { prisma } from '../db/prisma.js';
import { hashPassword } from './password.js';

/**
 * Cria o admin master a partir de MASTER_ADMIN_USER / MASTER_ADMIN_PASSWORD,
 * apenas se ainda não existir um usuário com esse nome. Nunca altera um existente.
 */
export async function ensureMasterAdmin() {
  const username = process.env.MASTER_ADMIN_USER?.trim();
  const password = process.env.MASTER_ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      'MASTER_ADMIN_USER/MASTER_ADMIN_PASSWORD não definidos — admin master não criado.',
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return;

  await prisma.user.create({
    data: {
      username,
      name: 'Administrador',
      passwordHash: await hashPassword(password),
      isMaster: true,
    },
  });
  console.log(`Admin master "${username}" criado.`);
}
