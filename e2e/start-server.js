// Sobe o app para os testes E2E: banco novo com as migrations reais e o servidor de
// produção (server/index.js), que também serve o build do React (client/dist).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.E2E_DATA_DIR;
if (!dataDir || !process.env.DATABASE_URL?.includes(dataDir)) {
  throw new Error('Rode pelo Playwright (npm run test:e2e): E2E_DATA_DIR/DATABASE_URL ausentes.');
}

if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) {
  throw new Error('Build do frontend não encontrado: rode `npm run build` antes.');
}

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

execSync('npx prisma migrate deploy', {
  cwd: path.join(ROOT, 'server'),
  stdio: ['ignore', 'ignore', 'inherit'],
  env: process.env,
});

await import('../server/index.js');
