// Servidor de produção do frontend (usado pelo PM2 em ecosystem.config.cjs).
// Serve o build em dist/ (com fallback para index.html, por causa das rotas do
// React) e encaminha /api para o backend, mantendo tudo na mesma origem.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 4101);
const API = new URL(process.env.API_URL || 'http://127.0.0.1:4100');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function proxy(req, res) {
  const upstream = http.request(
    {
      hostname: API.hostname,
      port: API.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: API.host, 'x-forwarded-host': req.headers.host },
    },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'API indisponível' }));
  });
  req.pipe(upstream);
}

function sendFile(res, file, cache) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  fs.createReadStream(file)
    .on('error', () => res.end())
    .pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) return proxy(req, res);

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  const file = path.join(DIST, path.normalize(pathname));
  if (file.startsWith(DIST + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    // Arquivos em assets/ têm hash no nome, então podem ficar em cache por muito tempo.
    const immutable = pathname.startsWith('/assets/');
    return sendFile(res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  }

  sendFile(res, path.join(DIST, 'index.html'), 'no-cache');
});

server.listen(PORT, () => {
  console.log(`goals-web ouvindo em http://localhost:${PORT} (API: ${API.origin})`);
});
