// Ponto de entrada do backend (usado pelo PM2 em ecosystem.config.cjs).
import 'dotenv/config';
import { createApp } from './src/app.js';

process.env.TZ ||= 'America/Sao_Paulo';

// O PM2 define PORT a partir de API_PORT; em desenvolvimento lê API_PORT do .env.
const port = Number(process.env.PORT || process.env.API_PORT || 4100);

const app = createApp();

app.listen(port, (err) => {
  if (err) throw err; // ex.: porta já em uso
  console.log(`goals-api ouvindo em http://localhost:${port}`);
});
