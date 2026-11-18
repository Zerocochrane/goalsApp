// Backup manual do banco: `npm run backup --prefix server` (o servidor também faz um por dia).
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../src/db/prisma.js';
import { backupDatabase } from '../src/backup/backup.js';

try {
  await connectDatabase();
  console.log(`Backup salvo em ${await backupDatabase()}`);
} catch (err) {
  console.error('Backup falhou:', err);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
