// SQLite temporário com as migrations reais, para os testes de API.
//
// Uso (no topo do arquivo de teste, ANTES de importar qualquer módulo de src/):
//   const db = await createTestDatabase('auth');
//   const { createApp } = await import('../../src/app.js');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../prisma/migrations',
);

export async function applyMigrations(prisma) {
  for (const dir of fs.readdirSync(MIGRATIONS).sort()) {
    const file = path.join(MIGRATIONS, dir, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, 'utf8').replace(/^\s*--.*$/gm, '');
    for (const statement of sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
}

export async function createTestDatabase(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goals-${name}-`));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  // O cliente Prisma é um singleton em globalThis: garante um novo, apontando para este banco
  delete globalThis.__goalsPrisma;

  const { prisma, connectDatabase, disconnectDatabase } = await import('../../src/db/prisma.js');
  await applyMigrations(prisma);
  await connectDatabase();

  return {
    prisma,
    /** Apaga todos os dados (a ordem respeita as chaves estrangeiras). */
    async reset() {
      await prisma.friendship.deleteMany();
      await prisma.taskOccurrence.deleteMany();
      await prisma.activity.deleteMany();
      await prisma.messageLog.deleteMany();
      await prisma.phoneVerification.deleteMany();
      await prisma.user.deleteMany();
    },
    async destroy() {
      await disconnectDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
