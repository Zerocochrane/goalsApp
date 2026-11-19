import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { prisma } from './db/prisma.js';
import { getWhatsAppStatus } from './whatsapp/whatsapp.js';
import { authRouter } from './auth/routes.js';
import { requireAuth } from './auth/middleware.js';
import { profileRouter, usersRouter } from './users/routes.js';
import { activitiesRouter } from './activities/routes.js';
import { calendarRouter } from './activities/calendar.js';
import { whatsappRouter } from './whatsapp/routes.js';
import { occurrencesRouter } from './occurrences/routes.js';
import { streakRouter } from './streak/routes.js';
import { friendsRouter } from './friends/routes.js';

// Build do React (gerado por `npm run build`). Pode ser trocado com CLIENT_DIST.
const DEFAULT_CLIENT_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client/dist',
);

export function createApp({ clientDist = process.env.CLIENT_DIST || DEFAULT_CLIENT_DIST } = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Cabeçalhos de segurança básicos (o Nginx acrescenta HSTS em produção)
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
  });
  // Em produção o app fica atrás do Nginx, na mesma máquina:
  // confia em proxies locais para obter o IP real do cliente (usado no rate limit).
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Rotas públicas
  // Saúde do app (PM2/deploy/monitoramento): 200 se o banco responde, 503 se não.
  app.get('/api/health', async (_req, res) => {
    let database = 'ok';
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      database = 'error';
    }
    const ok = database === 'ok';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'error',
      time: new Date().toISOString(),
      tz: process.env.TZ,
      uptime: Math.round(process.uptime()),
      database,
      whatsapp: getWhatsAppStatus().status,
    });
  });
  app.use('/api/auth', authRouter());

  // Daqui para baixo, tudo em /api exige login
  app.use('/api', requireAuth);

  app.use('/api/users', usersRouter()); // somente admin master
  app.use('/api/profile', profileRouter());
  app.use('/api/activities', activitiesRouter()); // sempre do próprio usuário
  app.use('/api/calendar', calendarRouter());
  app.use('/api/occurrences', occurrencesRouter()); // validação pelo link do WhatsApp
  app.use('/api/streak', streakRouter()); // sequência do próprio usuário
  app.use('/api/friends', friendsRouter()); // amigos e pedidos de amizade
  app.use('/api/whatsapp', whatsappRouter()); // somente admin master

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  // Frontend: serve o build do React e, para as rotas do React Router (ex.: /validar/:token),
  // devolve o index.html. Em desenvolvimento (sem build) quem serve o frontend é o Vite.
  const indexHtml = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    // Arquivos em assets/ têm hash no nome: podem ficar em cache "para sempre" (e um que
    // não existe é 404, não o index.html)
    app.use(
      '/assets',
      express.static(path.join(clientDist, 'assets'), { immutable: true, maxAge: '1y' }),
    );
    app.use('/assets', (_req, res) => res.status(404).end());
    app.use(express.static(clientDist, { index: false, maxAge: 0 }));
    app.get('/{*path}', (_req, res) => {
      res.set('cache-control', 'no-cache').sendFile('index.html', { root: clientDist });
    });
  }

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
