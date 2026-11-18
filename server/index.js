// Ponto de entrada do backend (usado pelo PM2 em ecosystem.config.cjs).
import 'dotenv/config';
import { createApp } from './src/app.js';
import { connectDatabase, disconnectDatabase } from './src/db/prisma.js';
import { assertAuthConfig } from './src/auth/session.js';
import { ensureMasterAdmin } from './src/auth/seed.js';
import { startWhatsApp, stopWhatsApp } from './src/whatsapp/whatsapp.js';
import { createScheduler } from './src/scheduler/scheduler.js';
import { scheduleDailyBackup } from './src/backup/backup.js';

process.env.TZ ||= 'America/Sao_Paulo';

// Em produção o PM2 define PORT=WEB_PORT (um único processo serve a API e o build do
// React); em desenvolvimento lê API_PORT do .env (o Vite serve o frontend em WEB_PORT).
const port = Number(process.env.PORT || process.env.API_PORT || 4100);

const journalMode = await connectDatabase();
console.log(`SQLite conectado (journal_mode=${journalMode})`);

assertAuthConfig();
await ensureMasterAdmin();

const app = createApp();

const server = app.listen(port, (err) => {
  if (err) throw err; // ex.: porta já em uso
  console.log(`goals-app ouvindo em http://localhost:${port}`);
});

// Reconecta o WhatsApp se já houver sessão pareada (sem novo QR Code)
startWhatsApp().catch((err) => console.error('[whatsapp] falha ao iniciar', err));

// Agendador: recupera o que ficou para trás enquanto o servidor estava fora e depois roda
// a cada minuto (gera ocorrências, envia o link, marca `falhou` o que venceu em 1 hora)
const scheduler = createScheduler();
scheduler.start();

// Backup diário do SQLite às 03:00 (server/data/backups)
const backup = scheduleDailyBackup();

// Encerramento limpo (PM2 envia SIGINT no reload/stop e espera kill_timeout = 10 s).
// A sessão do WhatsApp e o banco ficam em disco, então o próximo start continua de onde parou.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.log(`${signal} recebido — encerrando…`);
    scheduler.stop();
    backup.stop();
    stopWhatsApp();
    server.close(() => disconnectDatabase().finally(() => process.exit(0)));
    server.closeIdleConnections(); // conexões keep-alive paradas não seguram o encerramento
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
