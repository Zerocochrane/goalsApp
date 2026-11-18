// API: login, sessão (cookie/JWT), logout e rate limit.
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-auth');
const { buildApp, createUser, loginAs, sessionCookie, PASSWORD } =
  await import('../helpers/api.js');

const app = buildApp();
let ana;

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  ana = await createUser(db.prisma, { username: 'ana' });
});

let ip = 0;
/** Requisição de login vinda de um IP próprio (rate limit isolado por teste). */
const login = (body, from = `10.2.0.${++ip}`) =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', from).send(body);

describe('POST /api/auth/login', () => {
  test('credenciais certas: 200, usuário público e cookie de sessão seguro', async () => {
    const res = await login({ username: 'ana', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: ana.id, username: 'ana', isMaster: false });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('sessionVersion');

    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    expect(cookie.attrs).toContain('httponly');
    expect(cookie.attrs).toContain('samesite=lax');
    expect(cookie.attrs).toContain('path=/');
    expect(cookie.attrs.some((a) => a.startsWith('max-age=604800'))).toBe(true);
    // APP_URL http:// → sem "Secure" (senão o cookie não funcionaria sem HTTPS)
    expect(cookie.attrs).not.toContain('secure');

    const payload = jwt.decode(cookie.value, { complete: true });
    expect(payload.header.alg).toBe('HS256');
    expect(payload.payload.sub).toBe(String(ana.id));
  });

  test('usuário sem diferenciar maiúsculas e com espaços', async () => {
    const res = await login({ username: '  ANA ', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  test('senha errada e usuário inexistente: mesma resposta genérica', async () => {
    const wrong = await login({ username: 'ana', password: 'errada' });
    const missing = await login({ username: 'ninguem', password: 'errada' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'Usuário ou senha inválidos' });
    expect(missing.body).toEqual(wrong.body);
    expect(sessionCookie(wrong)).toBeNull();
  });

  test.each([
    [{}],
    [{ username: 'ana' }],
    [{ password: PASSWORD }],
    [{ username: '   ', password: PASSWORD }],
    [{ username: ['ana'], password: PASSWORD }],
    [{ username: 'ana', password: { $ne: '' } }],
  ])('campos ausentes ou de tipo errado → 400 (%j)', async (body) => {
    const res = await login(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Informe usuário e senha');
  });

  test('JSON malformado → 400 em pt-BR', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JSON inválido');
  });

  test('rate limit: 5 erros por minuto por IP, depois 429 até para a senha certa', async () => {
    const from = '10.9.9.9';
    for (let i = 0; i < 5; i++) {
      expect((await login({ username: 'ana', password: 'errada' }, from)).status).toBe(401);
    }
    const blocked = await login({ username: 'ana', password: PASSWORD }, from);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Muitas tentativas de login/);
    expect(blocked.headers).toHaveProperty('ratelimit');

    // Outro IP não é afetado
    expect((await login({ username: 'ana', password: PASSWORD }, '10.9.9.10')).status).toBe(200);
  });

  test('rate limit: logins certos não contam', async () => {
    const from = '10.9.8.1';
    for (let i = 0; i < 6; i++) {
      expect((await login({ username: 'ana', password: PASSWORD }, from)).status).toBe(200);
    }
  });
});

describe('sessão', () => {
  test('GET /me sem cookie → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Não autenticado');
  });

  test('GET /me logado → usuário', async () => {
    const agent = await loginAs(app, 'ana');
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('ana');
  });

  test.each([
    ['assinado com outro segredo', (sub) => jwt.sign({ sub }, 'outro-segredo')],
    ['algoritmo none', (sub) => jwt.sign({ sub }, null, { algorithm: 'none' })],
    ['expirado', (sub) => jwt.sign({ sub, exp: 1 }, process.env.JWT_SECRET)],
    ['lixo', () => 'nao-e-um-jwt'],
  ])('cookie inválido (%s) → 401', async (_name, makeToken) => {
    const token = makeToken(String(ana.id));
    const res = await request(app).get('/api/auth/me').set('Cookie', `goals_session=${token}`);
    expect(res.status).toBe(401);
  });

  test('usuário excluído: sessão cai e o cookie é limpo', async () => {
    const agent = await loginAs(app, 'ana');
    await db.prisma.user.delete({ where: { id: ana.id } });
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(sessionCookie(res)?.value).toBe('');
  });

  test('cookie antigo (sem versão de sessão) continua valendo', async () => {
    const token = jwt.sign({ sub: String(ana.id) }, process.env.JWT_SECRET, { expiresIn: 60 });
    const res = await request(app).get('/api/auth/me').set('Cookie', `goals_session=${token}`);
    expect(res.status).toBe(200);
  });

  test('logout limpa o cookie', async () => {
    const agent = await loginAs(app, 'ana');
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(204);
    const cookie = sessionCookie(res);
    expect(cookie.value).toBe('');
    expect(cookie.attrs).toContain('httponly');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('app', () => {
  test('/api/health é público', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  test('cabeçalhos de segurança e sem X-Powered-By', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test.each([
    ['get', '/api/users'],
    ['get', '/api/profile'],
    ['get', '/api/activities'],
    ['post', '/api/activities'],
    ['get', '/api/calendar?start=2026-11-16&end=2026-11-22'],
    ['post', '/api/occurrences/validate/abc'],
    ['get', '/api/streak'],
    ['get', '/api/whatsapp'],
    ['get', '/api/rota-inexistente'],
  ])('%s %s sem login → 401', async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });

  test('rota /api inexistente (logado) → 404 em pt-BR', async () => {
    const agent = await loginAs(app, 'ana');
    const res = await agent.get('/api/rota-inexistente');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Rota não encontrada');
  });
});
