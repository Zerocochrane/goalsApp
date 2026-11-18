// Configuração do PM2 — usada por scripts/deploy-pm2.sh
// Roda no mesmo servidor do Site (processo "photo-portfolio", porta 4000),
// por isso usa nomes e portas próprios. As portas vêm de server/.env.
const fs = require('fs');
const path = require('path');

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = readEnv(path.join(__dirname, 'server', '.env'));
const API_PORT = env.API_PORT || '4100';
const WEB_PORT = env.WEB_PORT || '4101';

module.exports = {
  apps: [
    {
      // Backend (Express + agendador + WhatsApp)
      name: 'goals-api',
      cwd: './server',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1, // manter 1: SQLite, agendador e sessão do WhatsApp não podem duplicar
      autorestart: true,
      max_memory_restart: '400M',
      restart_delay: 3000,
      env: { NODE_ENV: 'production', TZ: 'America/Sao_Paulo', PORT: API_PORT },
      out_file: '../logs/api-out.log',
      error_file: '../logs/api-error.log',
      time: true,
    },
    {
      // Frontend (build do React servido como arquivos estáticos;
      // encaminha /api para o backend, mantendo cookies na mesma origem)
      name: 'goals-web',
      cwd: './client',
      script: 'serve.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      restart_delay: 3000,
      env: { NODE_ENV: 'production', PORT: WEB_PORT, API_URL: `http://127.0.0.1:${API_PORT}` },
      out_file: '../logs/web-out.log',
      error_file: '../logs/web-error.log',
      time: true,
    },
  ],
};
