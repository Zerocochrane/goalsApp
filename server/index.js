// Ponto de entrada do backend (usado pelo PM2 em ecosystem.config.cjs).
import 'dotenv/config';
import { createApp } from './src/app.js';
import { connectDatabase, disconnectDatabase } from './src/db/prisma.js';
import { assertAuthConfig } from './src/auth/session.js';
import { ensureMasterAdmin } from './src/auth/seed.js';
import { startWhatsApp, stopWhatsApp } from './src/whatsapp/whatsapp.js';
import { createScheduler } from './src/scheduler/scheduler.js';

process.env.TZ ||= 'America/Sao_Paulo';

// O PM2 define PORT a partir de API_PORT; em desenvolvimento lê API_PORT do .env.
const port = Number(process.env.PORT || process.env.API_PORT || 4100);

const journalMode = await connectDatabase();
console.log(`SQLite conectado (journal_mode=${journalMode})`);

assertAuthConfig();
await ensureMasterAdmin();

const app = createApp();

const server = app.listen(port, (err) => {
  if (err) throw err; // ex.: porta já em uso
  console.log(`goals-api ouvindo em http://localhost:${port}`);
});

// Reconecta o WhatsApp se já houver sessão pareada (sem novo QR Code)
startWhatsApp().catch((err) => console.error('[whatsapp] falha ao iniciar', err));

// Agendador: recupera o que ficou para trás enquanto o servidor estava fora e depois roda
// a cada minuto (gera ocorrências, envia o link, marca `falhou` o que venceu em 1 hora)
const scheduler = createScheduler();
scheduler.start();

// Encerramento limpo (PM2 envia SIGINT no reload/stop)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    scheduler.stop();
    stopWhatsApp();
    server.close(() => disconnectDatabase().finally(() => process.exit(0)));
  });
}
