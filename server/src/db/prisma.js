// Cliente Prisma único para todo o backend (singleton).
// Usa o driver better-sqlite3 e liga o modo WAL na primeira conexão.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const url = process.env.DATABASE_URL || 'file:./data/goals.db';

// Garante que a pasta do arquivo do banco exista (ex.: server/data/)
const file = url.replace(/^file:/, '');
if (file && file !== ':memory:')
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

function createClient() {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

// Reaproveita a instância entre recargas (node --watch / testes)
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__goalsPrisma ?? createClient();
globalForPrisma.__goalsPrisma = prisma;

let ready;
/**
 * Abre a conexão e aplica os PRAGMAs do SQLite. Chame uma vez no start do servidor.
 * O modo WAL é persistente no arquivo; busy_timeout evita erros "database is locked".
 */
export function connectDatabase() {
  ready ??= (async () => {
    await prisma.$connect();
    const [{ journal_mode: mode }] = await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
    return mode;
  })();
  return ready;
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  ready = undefined;
}
