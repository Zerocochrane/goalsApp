// Configuração do PM2 — usada por scripts/deploy-pm2.sh (`npm run deploy`).
//
// Um ÚNICO processo, "goals-app": o Express serve a API (/api) e o build do React
// (client/dist). Fica em 1 instância em modo fork — o SQLite, o agendador e a sessão do
// WhatsApp não podem existir em dobro (cluster ou 2 instâncias = mensagens duplicadas e
// sessão do WhatsApp derrubada).
//
// Roda no mesmo servidor do Site (processo "photo-portfolio", porta 4000), por isso usa
// nome e porta próprios. Ele escuta em WEB_PORT de server/.env (padrão 4101), a porta
// pública do app (atrás do Nginx). API_PORT só é usada em desenvolvimento.
//
// Logs em logs/ com rotação pelo módulo pm2-logrotate (instalado pelo deploy).
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
const WEB_PORT = env.WEB_PORT || '4101';

module.exports = {
  apps: [
    {
      name: 'goals-app',
      cwd: path.join(__dirname, 'server'),
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1, // NUNCA aumentar: agendador e sessão do WhatsApp não podem duplicar
      autorestart: true,
      max_memory_restart: '400M',
      restart_delay: 3000,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 10000, // tempo para fechar WhatsApp e banco (SIGINT) antes do SIGKILL
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Sao_Paulo',
        PORT: WEB_PORT,
      },
      out_file: path.join(__dirname, 'logs', 'app-out.log'),
      error_file: path.join(__dirname, 'logs', 'app-error.log'),
      time: true,
    },
  ],
};
