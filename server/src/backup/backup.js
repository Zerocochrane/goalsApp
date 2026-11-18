// Backup do banco SQLite.
//
// Usa `VACUUM INTO`, que gera uma cópia consistente do banco com o servidor rodando
// (inclui o que ainda está no arquivo -wal), sem travar as gravações por muito tempo.
// Os arquivos ficam em BACKUP_DIR (padrão server/data/backups, que o deploy nunca apaga)
// com o nome goals-AAAA-MM-DD.db; o do mesmo dia é sobrescrito. Backups com mais de
// BACKUP_KEEP_DAYS dias são apagados.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { TIME_ZONE, todayInSaoPaulo } from '../activities/recurrence.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE_RE = /^goals-(\d{4}-\d{2}-\d{2})\.db$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function backupDir() {
  return path.resolve(SERVER_DIR, process.env.BACKUP_DIR || 'data/backups');
}

function keepDays() {
  const n = Number(process.env.BACKUP_KEEP_DAYS);
  return Number.isInteger(n) && n > 0 ? n : 14;
}

/** Nomes de backup que já passaram do prazo de retenção (datas AAAA-MM-DD). */
export function expiredBackups(files, today, days) {
  const limit = Date.parse(`${today}T00:00:00Z`) - days * DAY_MS;
  return files.filter((f) => {
    const m = f.match(FILE_RE);
    return m && Date.parse(`${m[1]}T00:00:00Z`) <= limit;
  });
}

/**
 * Gera o backup de hoje e apaga os antigos. Devolve o caminho do arquivo criado.
 */
export async function backupDatabase({
  prisma = defaultPrisma,
  dir = backupDir(),
  today = todayInSaoPaulo(),
  days = keepDays(),
} = {}) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `goals-${today}.db`);
  const tmp = `${file}.tmp`;
  await fs.rm(tmp, { force: true });
  // VACUUM INTO não aceita parâmetros; o caminho é nosso (sem entrada do usuário)
  await prisma.$executeRawUnsafe(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  await fs.rename(tmp, file);

  for (const old of expiredBackups(await fs.readdir(dir), today, days)) {
    await fs.rm(path.join(dir, old), { force: true });
  }
  return file;
}

/** Backup diário às 03:00 (America/Sao_Paulo). Devolve { stop }. */
export function scheduleDailyBackup() {
  const task = cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        const file = await backupDatabase();
        console.log(`[backup] banco salvo em ${file}`);
      } catch (err) {
        console.error('[backup] falhou', err);
      }
    },
    { timezone: TIME_ZONE },
  );
  return { stop: () => task.stop() };
}
