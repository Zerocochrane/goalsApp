// API: cadastro pela própria pessoa (#30) — modos, código do WhatsApp, aprovação pelo master.
import { describe, test, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-signup');
const { buildApp, createUser, fakeWhatsApp, anonymousAgent, loginAs, PASSWORD } =
  await import('../helpers/api.js');

const PHONE = '+5532999998888';
let wa, app;

const form = (overrides = {}) => ({
  name: 'Bia Souza',
  username: 'bia',
  password: 'senha123',
  passwordConfirm: 'senha123',
  phone: '+55 (32) 99999-8888',
  ...overrides,
});

/** Cadastra e devolve { agent, res, ticket }. Cada cadastro sai de um IP novo. */
async function signup(overrides) {
  const agent = anonymousAgent(app);
  const res = await agent.post('/api/signup').send(form(overrides));
  return { agent, res, ticket: res.body.ticket };
}

const findUser = (username) => db.prisma.user.findUnique({ where: { username } });

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  wa = fakeWhatsApp();
  app = buildApp({ send: wa.send });
  delete process.env.SIGNUP_MODE;
});
afterEach(() => {
  delete process.env.SIGNUP_MODE;
});

describe('GET /api/signup/config', () => {
  test.each([
    [undefined, 'aprovacao'],
    ['aprovacao', 'aprovacao'],
    ['aberto', 'aberto'],
    ['DESLIGADO', 'desligado'],
    ['qualquer-coisa', 'aprovacao'],
  ])('SIGNUP_MODE=%s → %s', async (env, mode) => {
    if (env !== undefined) process.env.SIGNUP_MODE = env;
    const res = await anonymousAgent(app).get('/api/signup/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode });
  });
});

describe('POST /api/signup', () => {
  test('cria conta comum pendente (nunca master) e envia o código pelo WhatsApp', async () => {
    const { res } = await signup({ isMaster: true, status: 'ativo' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      phone: '+55 (32) 9****-8888',
      resendIn: 60,
      mode: 'aprovacao',
    });
    expect(res.body.ticket).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();

    const user = await findUser('bia');
    expect(user).toMatchObject({
      name: 'Bia Souza',
      phone: PHONE,
      isMaster: false,
      status: 'pendente',
      createdBy: 'cadastro',
      phoneVerifiedAt: null,
    });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/); // bcrypt

    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0].phone).toBe(PHONE);
    expect(wa.lastCode(PHONE)).toMatch(/^\d{6}$/);
    // Só o hash fica no banco
    const verification = await db.prisma.phoneVerification.findUnique({
      where: { userId: user.id },
    });
    expect(verification.codeHash).not.toContain(wa.lastCode(PHONE));
    expect(verification.attempts).toBe(0);
  });

  test.each([
    [{ name: '' }, 'name', 'Informe o nome'],
    [{ username: 'b' }, 'username', /de 3 a 32 caracteres/],
    [{ password: '123', passwordConfirm: '123' }, 'password', /pelo menos 6/],
    [{ passwordConfirm: 'outra-senha' }, 'passwordConfirm', 'As senhas não coincidem'],
    [{ phone: '' }, 'phone', 'Informe o telefone WhatsApp'],
    [{ phone: '32999998888' }, 'phone', /DDI 55/],
    [{ phone: '+55 (20) 99999-8888' }, 'phone', 'DDD inválido'],
  ])('validação: %j → 400 em %s', async (overrides, field, message) => {
    const { res } = await signup(overrides);
    expect(res.status).toBe(400);
    expect(res.body.fields[field]).toEqual(
      message instanceof RegExp ? expect.stringMatching(message) : message,
    );
    expect(await findUser('bia')).toBeNull();
    expect(wa.sent).toHaveLength(0);
  });

  test('nome de usuário já em uso (sem diferenciar maiúsculas) → 409', async () => {
    await createUser(db.prisma, { username: 'bia' });
    const { res } = await signup({ username: 'BIA' });
    expect(res.status).toBe(409);
    expect(res.body.fields.username).toBe('Este nome de usuário já está em uso');
  });

  test('telefone já usado por outra conta: não revela (cadastra normalmente)', async () => {
    await createUser(db.prisma, { username: 'ana', phone: PHONE, phoneVerifiedAt: new Date() });
    const { res } = await signup();
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/ana|já|cadastrado/i);
  });

  test('campo isca preenchido (robô): finge sucesso sem criar conta nem enviar código', async () => {
    const { res } = await signup({ website: 'http://spam.example' });
    expect(res.status).toBe(201);
    expect(res.body.ticket).toEqual(expect.any(String));
    expect(await findUser('bia')).toBeNull();
    expect(wa.sent).toHaveLength(0);
  });

  test('SIGNUP_MODE=desligado → 403, nada criado', async () => {
    process.env.SIGNUP_MODE = 'desligado';
    const { res } = await signup();
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cadastro está desativado/);
    expect(await findUser('bia')).toBeNull();
  });

  test('rate limit: um código por minuto por IP', async () => {
    const agent = anonymousAgent(app);
    expect((await agent.post('/api/signup').send(form())).status).toBe(201);
    const second = await agent.post('/api/signup').send(form({ username: 'bia2' }));
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/Aguarde um minuto/);
    expect(await findUser('bia2')).toBeNull();
  });

  test('erro de validação não gasta o limite de códigos do IP', async () => {
    const agent = anonymousAgent(app);
    expect((await agent.post('/api/signup').send(form({ phone: '' }))).status).toBe(400);
    expect((await agent.post('/api/signup').send(form())).status).toBe(201);
  });
});

describe('POST /api/signup/verify-phone', () => {
  test('código certo (modo aprovação): telefone confirmado, conta segue pendente', async () => {
    const admin = await createUser(db.prisma, {
      username: 'admin',
      isMaster: true,
      phone: '+5532911112222',
      phoneVerifiedAt: new Date(),
    });
    const { agent, ticket } = await signup();
    const res = await agent
      .post('/api/signup/verify-phone')
      .send({ ticket, code: wa.lastCode(PHONE) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pendente' });
    expect(res.headers['set-cookie']).toBeUndefined();

    const user = await findUser('bia');
    expect(user.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(user.status).toBe('pendente');
    // O código não vale de novo
    expect(await db.prisma.phoneVerification.count()).toBe(0);

    // Aviso ao master
    expect(wa.sent.find((m) => m.phone === admin.phone)?.text).toMatch(
      /Novo cadastro aguardando aprovação.*Bia Souza.*@bia/,
    );

    // Ainda não entra
    const login = await anonymousAgent(app)
      .post('/api/auth/login')
      .send({ username: 'bia', password: 'senha123' });
    expect(login.status).toBe(403);
    expect(login.body).toMatchObject({
      code: 'pending_approval',
      error: 'Sua conta aguarda aprovação do administrador.',
    });
    expect(login.headers['set-cookie']).toBeUndefined();
  });

  test('modo aberto: código certo libera a conta e já entra (cria atividades)', async () => {
    process.env.SIGNUP_MODE = 'aberto';
    const { agent, ticket } = await signup();
    const res = await agent
      .post('/api/signup/verify-phone')
      .send({ ticket, code: wa.lastCode(PHONE) });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ativo');
    expect(res.body.user).toMatchObject({ username: 'bia', status: 'ativo', isMaster: false });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    expect((await agent.get('/api/auth/me')).status).toBe(200);
    const activity = await agent
      .post('/api/activities')
      .send({ name: 'Academia', hour: 7, minute: 30, weekdays: [1, 3, 5] });
    expect(activity.status).toBe(201);

    // E também entra pela tela de login
    await loginAs(app, 'bia', 'senha123');
  });

  test('código errado → 400 com tentativas restantes; o certo ainda funciona', async () => {
    const { agent, ticket } = await signup();
    const code = wa.lastCode(PHONE);
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await agent.post('/api/signup/verify-phone').send({ ticket, code: wrong });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Código inválido ou expirado', attemptsLeft: 4 });
    expect((await agent.post('/api/signup/verify-phone').send({ ticket, code })).status).toBe(200);
  });

  test('código fora do formato → 400 sem gastar tentativa', async () => {
    const { agent, ticket } = await signup();
    const res = await agent.post('/api/signup/verify-phone').send({ ticket, code: '12ab' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Informe o código de 6 dígitos');
    const verification = await db.prisma.phoneVerification.findFirst();
    expect(verification.attempts).toBe(0);
  });

  test('código expirado (mais de 10 minutos) → 400', async () => {
    const { agent, ticket } = await signup();
    await db.prisma.phoneVerification.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await agent
      .post('/api/signup/verify-phone')
      .send({ ticket, code: wa.lastCode(PHONE) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Código inválido ou expirado');
    expect((await findUser('bia')).phoneVerifiedAt).toBeNull();
  });

  test('vale 10 minutos a partir do envio', async () => {
    const before = Date.now();
    await signup();
    const { expiresAt } = await db.prisma.phoneVerification.findFirst();
    const ttl = expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(9.9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000 + 2000);
  });

  test('5 tentativas erradas bloqueiam o código (nem o certo passa); um novo funciona', async () => {
    const { agent, ticket } = await signup();
    const code = wa.lastCode(PHONE);
    const wrong = code === '000000' ? '111111' : '000000';
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/api/signup/verify-phone').send({ ticket, code: wrong });
      statuses.push([res.status, res.body.attemptsLeft]);
    }
    expect(statuses).toEqual([
      [400, 4],
      [400, 3],
      [400, 2],
      [400, 1],
      [429, 0],
    ]);
    const blocked = await agent.post('/api/signup/verify-phone').send({ ticket, code });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('Muitas tentativas erradas. Peça um novo código.');

    // Novo código (um minuto depois, de outra rede)
    await db.prisma.phoneVerification.updateMany({
      data: { createdAt: new Date(Date.now() - 61 * 1000) },
    });
    const resend = await anonymousAgent(app).post('/api/signup/resend-code').send({ ticket });
    expect(resend.status).toBe(200);
    const fresh = wa.lastCode(PHONE);
    const ok = await agent.post('/api/signup/verify-phone').send({ ticket, code: fresh });
    expect(ok.status).toBe(200);
  });

  test('ticket inválido ou de conta já confirmada → 400', async () => {
    const bad = await anonymousAgent(app)
      .post('/api/signup/verify-phone')
      .send({ ticket: 'nao-e-um-ticket', code: '123456' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('ticket_invalid');

    const { agent, ticket } = await signup();
    const code = wa.lastCode(PHONE);
    expect((await agent.post('/api/signup/verify-phone').send({ ticket, code })).status).toBe(200);
    const again = await agent.post('/api/signup/verify-phone').send({ ticket, code });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('ticket_invalid');
  });

  test('o ticket do cadastro não vale como sessão', async () => {
    process.env.SIGNUP_MODE = 'aberto';
    const { ticket } = await signup();
    await db.prisma.user.update({ where: { username: 'bia' }, data: { status: 'ativo' } });
    const res = await anonymousAgent(app)
      .get('/api/auth/me')
      .set('Cookie', `goals_session=${ticket}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/signup/resend-code', () => {
  test('antes de 1 minuto → 429 com retryAfter; depois → código novo (o antigo não vale)', async () => {
    const { ticket } = await signup();
    const first = wa.lastCode(PHONE);

    const early = await anonymousAgent(app).post('/api/signup/resend-code').send({ ticket });
    expect(early.status).toBe(429);
    expect(early.body.retryAfter).toBeGreaterThan(50);
    expect(wa.sent).toHaveLength(1);

    await db.prisma.phoneVerification.updateMany({
      data: { createdAt: new Date(Date.now() - 61 * 1000) },
    });
    const res = await anonymousAgent(app).post('/api/signup/resend-code').send({ ticket });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resendIn: 60, expiresIn: 600, phone: '+55 (32) 9****-8888' });
    expect(wa.sent).toHaveLength(2);

    const second = wa.lastCode(PHONE);
    if (first !== second) {
      const old = await anonymousAgent(app)
        .post('/api/signup/verify-phone')
        .send({ ticket, code: first });
      expect(old.status).toBe(400);
    }
    const ok = await anonymousAgent(app)
      .post('/api/signup/verify-phone')
      .send({ ticket, code: second });
    expect(ok.status).toBe(200);
  });

  test('rate limit por IP: 1 por minuto, mesmo com tickets diferentes', async () => {
    const one = await signup({ username: 'bia1' });
    const two = await signup({ username: 'bia2', phone: '+5532988887777' });
    await db.prisma.phoneVerification.updateMany({
      data: { createdAt: new Date(Date.now() - 61 * 1000) },
    });
    const agent = anonymousAgent(app);
    expect((await agent.post('/api/signup/resend-code').send({ ticket: one.ticket })).status).toBe(
      200,
    );
    const blocked = await agent.post('/api/signup/resend-code').send({ ticket: two.ticket });
    expect(blocked.status).toBe(429);
  });
});

describe('login de conta do cadastro', () => {
  test('telefone não confirmado: senha certa devolve um ticket novo para a tela do código', async () => {
    await signup();
    const res = await anonymousAgent(app)
      .post('/api/auth/login')
      .send({ username: 'bia', password: 'senha123' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'phone_unverified',
      phone: '+55 (32) 9****-8888',
      ticket: expect.any(String),
    });
    expect(res.body.resendIn).toBeGreaterThan(0);

    const ok = await anonymousAgent(app)
      .post('/api/signup/verify-phone')
      .send({ ticket: res.body.ticket, code: wa.lastCode(PHONE) });
    expect(ok.status).toBe(200);
  });

  test('senha errada não revela que a conta está pendente', async () => {
    await signup();
    const res = await anonymousAgent(app)
      .post('/api/auth/login')
      .send({ username: 'bia', password: 'errada123' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Usuário ou senha inválidos' });
  });
});

describe('conta pendente não usa a API', () => {
  test.each(['/api/auth/me', '/api/activities', '/api/profile', '/api/friends'])(
    'sessão de conta que voltou a pendente: GET %s → 403 com mensagem clara',
    async (url) => {
      await createUser(db.prisma, { username: 'ana' });
      const ana = await loginAs(app, 'ana');
      await db.prisma.user.update({ where: { username: 'ana' }, data: { status: 'pendente' } });
      const res = await ana.get(url);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'Sua conta aguarda aprovação do administrador.',
        code: 'pending_approval',
      });
      // O cookie é apagado: a próxima chamada já é anônima
      expect((await ana.get(url)).status).toBe(401);
    },
  );

  test('não aparece para pedidos de amizade', async () => {
    await createUser(db.prisma, { username: 'ana' });
    await signup();
    const ana = await loginAs(app, 'ana');
    const res = await ana.post('/api/friends/requests').send({ username: 'bia' });
    expect(res.status).toBe(404);
  });
});

describe('aprovação pelo master', () => {
  let master;
  beforeEach(async () => {
    await createUser(db.prisma, { username: 'admin', isMaster: true });
    master = await loginAs(app, 'admin');
  });

  async function verifiedSignup() {
    const { agent, ticket } = await signup();
    await agent.post('/api/signup/verify-phone').send({ ticket, code: wa.lastCode(PHONE) });
    return findUser('bia');
  }

  test('lista mostra status, origem e telefone confirmado; contador de pendentes', async () => {
    await verifiedSignup();
    const list = await master.get('/api/users');
    const bia = list.body.users.find((u) => u.username === 'bia');
    expect(bia).toMatchObject({ status: 'pendente', createdBy: 'cadastro' });
    expect(bia.phoneVerifiedAt).toBeTruthy();
    expect((await master.get('/api/users/pending-count')).body).toEqual({ count: 1 });
  });

  test('aprovar: conta ativa, pessoa avisada pelo WhatsApp e consegue entrar', async () => {
    const bia = await verifiedSignup();
    const res = await master.post(`/api/users/${bia.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'bia', status: 'ativo' });
    expect(wa.sent.at(-1)).toMatchObject({ phone: PHONE, text: expect.stringMatching(/aprovada/) });
    expect((await master.get('/api/users/pending-count')).body).toEqual({ count: 0 });

    const agent = await loginAs(app, 'bia', 'senha123');
    expect((await agent.get('/api/activities')).status).toBe(200);

    const again = await master.post(`/api/users/${bia.id}/approve`);
    expect(again.status).toBe(409);
  });

  test('aprovar antes de confirmar o telefone: entra, mas sem lembretes até confirmar', async () => {
    await signup();
    const bia = await findUser('bia');
    expect((await master.post(`/api/users/${bia.id}/approve`)).status).toBe(200);
    expect(wa.sent).toHaveLength(1); // só o código; sem aviso para número não confirmado
    const agent = await loginAs(app, 'bia', 'senha123');
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.phoneVerifiedAt).toBeNull();
  });

  test('recusar: apaga a conta pendente e libera o nome de usuário', async () => {
    const bia = await verifiedSignup();
    expect((await master.post(`/api/users/${bia.id}/reject`)).status).toBe(204);
    expect(await findUser('bia')).toBeNull();
    expect((await signup()).res.status).toBe(201);
  });

  test('recusar conta ativa → 409; inexistente → 404', async () => {
    const ana = await createUser(db.prisma, { username: 'ana' });
    expect((await master.post(`/api/users/${ana.id}/reject`)).status).toBe(409);
    expect(await findUser('ana')).not.toBeNull();
    expect((await master.post('/api/users/99999/reject')).status).toBe(404);
    expect((await master.post('/api/users/99999/approve')).status).toBe(404);
  });

  test('editar o nome de uma conta pendente não confirma o telefone', async () => {
    await signup();
    const bia = await findUser('bia');
    const res = await master
      .put(`/api/users/${bia.id}`)
      .send({ name: 'Bia S.', phone: '+55 (32) 99999-8888' });
    expect(res.status).toBe(200);
    expect((await findUser('bia')).phoneVerifiedAt).toBeNull();
  });

  test('usuário comum não aprova nem recusa', async () => {
    await createUser(db.prisma, { username: 'ana' });
    const ana = await loginAs(app, 'ana');
    await signup();
    const bia = await findUser('bia');
    expect((await ana.post(`/api/users/${bia.id}/approve`)).status).toBe(403);
    expect((await ana.post(`/api/users/${bia.id}/reject`)).status).toBe(403);
    expect((await ana.get('/api/users/pending-count')).status).toBe(403);
  });

  test('usuário criado pelo master já nasce com o telefone confirmado', async () => {
    const res = await master
      .post('/api/users')
      .send({ name: 'Caio', username: 'caio', password: PASSWORD, phone: '+5532977776666' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ status: 'ativo', createdBy: 'master' });
    expect(res.body.user.phoneVerifiedAt).toBeTruthy();
  });
});

describe('Meu perfil: troca de telefone', () => {
  test('conta do cadastro: número novo precisa ser confirmado por código', async () => {
    process.env.SIGNUP_MODE = 'aberto';
    const { agent: signupAgent, ticket } = await signup();
    await signupAgent.post('/api/signup/verify-phone').send({ ticket, code: wa.lastCode(PHONE) });
    // Outra rede: o envio do cadastro já gastou o limite de 1 código por minuto do IP
    const agent = await loginAs(app, 'bia', 'senha123');

    const NEW = '+5532977776666';
    const saved = await agent.put('/api/profile').send({ phone: '+55 (32) 97777-6666' });
    expect(saved.status).toBe(200);
    expect(saved.body.user).toMatchObject({ phone: NEW, phoneVerifiedAt: null });

    const sent = await agent.post('/api/profile/phone/send-code');
    expect(sent.status).toBe(200);
    expect(sent.body.phone).toBe('+55 (32) 9****-6666');
    const wrong = await agent.post('/api/profile/phone/verify').send({ code: '12345' });
    expect(wrong.status).toBe(400);
    const ok = await agent.post('/api/profile/phone/verify').send({ code: wa.lastCode(NEW) });
    expect(ok.status).toBe(200);
    expect(ok.body.user.phoneVerifiedAt).toBeTruthy();

    // Nada mais a confirmar
    expect((await agent.post('/api/profile/phone/send-code')).status).toBe(409);
  });

  test('código enviado para o número antigo não confirma o novo', async () => {
    process.env.SIGNUP_MODE = 'aberto';
    const { agent: signupAgent, ticket } = await signup();
    await signupAgent.post('/api/signup/verify-phone').send({ ticket, code: wa.lastCode(PHONE) });
    // Outra rede: o envio do cadastro já gastou o limite de 1 código por minuto do IP
    const agent = await loginAs(app, 'bia', 'senha123');
    await agent.put('/api/profile').send({ phone: '+5532977776666' });
    await agent.post('/api/profile/phone/send-code');
    const code = wa.lastCode('+5532977776666');
    await agent.put('/api/profile').send({ phone: '+5532966665555' });
    const res = await agent.post('/api/profile/phone/verify').send({ code });
    expect(res.status).toBe(400);
  });

  test('conta criada pelo master: troca de telefone segue confirmada (como antes)', async () => {
    await createUser(db.prisma, { username: 'ana', phone: PHONE, phoneVerifiedAt: new Date() });
    const ana = await loginAs(app, 'ana');
    const res = await ana.put('/api/profile').send({ phone: '+5532977776666' });
    expect(res.status).toBe(200);
    expect(res.body.user.phoneVerifiedAt).toBeTruthy();
    expect(wa.sent).toHaveLength(0);
  });
});
