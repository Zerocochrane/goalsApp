// Testes de ponta a ponta (Playwright). Rode com `npm run test:e2e` (compila o frontend
// antes). Sobe o app de verdade (server/index.js servindo client/dist) com um SQLite
// próprio em e2e/.data/, apagado a cada execução. O WhatsApp fica desligado.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4199;
const BASE_URL = `http://127.0.0.1:${PORT}`;
export const E2E_DATA_DIR = path.join(ROOT, 'e2e', '.data');

// Também vale para os workers: os testes leem/escrevem o mesmo banco que o servidor
// (ex.: para rodar o agendador com relógio simulado).
process.env.DATABASE_URL = `file:${path.join(E2E_DATA_DIR, 'e2e.db')}`;
process.env.E2E_ADMIN_USER = 'admin';
process.env.E2E_ADMIN_PASSWORD = 'admin-e2e-123';
process.env.WA_DISABLED = 'true';

export default defineConfig({
  testDir: 'e2e',
  // Um worker: os testes rodam o agendador sobre o banco inteiro
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/start-server.js',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    env: {
      PORT: String(PORT),
      APP_URL: BASE_URL,
      DATABASE_URL: process.env.DATABASE_URL,
      E2E_DATA_DIR,
      JWT_SECRET: 'segredo-e2e-com-mais-de-trinta-e-dois-caracteres',
      COOKIE_SECURE: 'false',
      MASTER_ADMIN_USER: process.env.E2E_ADMIN_USER,
      MASTER_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
      WA_DISABLED: 'true',
      BACKUP_DIR: path.join(E2E_DATA_DIR, 'backups'),
      TZ: 'America/Sao_Paulo',
    },
  },
});
