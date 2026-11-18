import express from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from './auth/routes.js';
import { requireAuth } from './auth/middleware.js';
import { profileRouter, usersRouter } from './users/routes.js';
import { activitiesRouter } from './activities/routes.js';
import { calendarRouter } from './activities/calendar.js';
import { whatsappRouter } from './whatsapp/routes.js';
import { occurrencesRouter } from './occurrences/routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // A API fica atrás do goals-web (e talvez de um nginx), todos na mesma máquina:
  // confia em proxies locais para obter o IP real do cliente (usado no rate limit).
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
  app.use(express.json());
  app.use(cookieParser());

  // Rotas públicas
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), tz: process.env.TZ });
  });
  app.use('/api/auth', authRouter());

  // Daqui para baixo, tudo em /api exige login
  app.use('/api', requireAuth);

  app.use('/api/users', usersRouter()); // somente admin master
  app.use('/api/profile', profileRouter());
  app.use('/api/activities', activitiesRouter()); // sempre do próprio usuário
  app.use('/api/calendar', calendarRouter());
  app.use('/api/occurrences', occurrencesRouter()); // validação pelo link do WhatsApp
  app.use('/api/whatsapp', whatsappRouter()); // somente admin master

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  // Erros inesperados (Express 5 encaminha também erros de handlers async)
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON inválido' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  });

  return app;
}
