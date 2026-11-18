// API: gestão de usuários (só admin master), "Meu perfil" e permissões.
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-users');
const { buildApp, createUser, createActivity, loginAs, sessionCookie, PASSWORD } =
  await import('../helpers/api.js');

const app = buildApp();
let admin, ana, master, user;

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  admin = await createUser(db.prisma, { username: 'admin', isMaster: true });
  ana = await createUser(db.prisma, { username: 'ana' });
  master = await loginAs(app, 'admin');
  user = await loginAs(app, 'ana');
});

describe('permissões', () => {
  test.each([
    ['get', '/api/users'],
    ['post', '/api/users'],
    ['put', '/api/users/1'],
    ['delete', '/api/users/1'],
    ['get', '/api/whatsapp'],
    ['post', '/api/whatsapp/connect'],
    ['post', '/api/whatsapp/logout'],
    ['post', '/api/whatsapp/test'],
  ])('usuário comum: %s %s → 403', async (method, url) => {
    const res = await user[method](url).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acesso restrito ao administrador');
  });

  test('admin master lista usuários sem expor hash de senha', async () => {
    const res = await master.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).toEqual(['admin', 'ana']);
    for (const u of res.body.users) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('sessionVersion');
    }
  });
});

describe('POST /api/users', () => {
  test('cria usuário comum, normaliza usuário e telefone', async () => {
    const res = await master.post('/api/users').send({
      name: '  Bia   Souza ',
      username: 'Bia.Souza',
      password: 'senha123',
      phone: '+55 (32) 99999-8888',
      isMaster: true, // ignorado: nunca cria outro master
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: 'Bia Souza',
      username: 'bia.souza',
      phone: '+5532999998888',
      isMaster: false,
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    // O novo usuário consegue entrar
    await loginAs(app, 'bia.souza', 'senha123');
  });

  test.each([
    [{ username: 'bia', password: 'senha123' }, 'name', 'Informe o nome'],
    [{ name: 'Bia', password: 'senha123' }, 'username', 'Informe o usuário'],
    [{ name: 'Bia', username: 'b', password: 'senha123' }, 'username', /de 3 a 32 caracteres/],
    [{ name: 'Bia', username: 'bia souza', password: 'senha123' }, 'username', /letras sem acento/],
    [{ name: 'Bia', username: 'bia' }, 'password', 'Informe a senha'],
    [{ name: 'Bia', username: 'bia', password: '123' }, 'password', /pelo menos 6/],
    [{ name: 'Bia', username: 'bia', password: 'x'.repeat(73) }, 'password', 'Senha muito longa'],
    [
      { name: 'Bia', username: 'bia', password: 'senha123', phone: '32999998888' },
      'phone',
      /DDI 55/,
    ],
    [
      { name: 'Bia', username: 'bia', password: 'senha123', phone: '+55 (20) 99999-8888' },
      'phone',
      'DDD inválido',
    ],
  ])('validação: %j → 400 em %s', async (body, field, message) => {
    const res = await master.post('/api/users').send(body);
    expect(res.status).toBe(400);
    expect(res.body.fields[field]).toEqual(
      message instanceof RegExp ? expect.stringMatching(message) : message,
    );
    expect(res.body.error).toBeTruthy();
  });

  test('usuário repetido → 409', async () => {
    const res = await master
      .post('/api/users')
      .send({ name: 'Outra Ana', username: 'ANA', password: 'senha123' });
    expect(res.status).toBe(409);
    expect(res.body.fields.username).toBe('Já existe um usuário com esse nome de usuário');
  });
});

describe('PUT /api/users/:id', () => {
  test('edita nome e telefone; senha em branco mantém a atual', async () => {
    const res = await master
      .put(`/api/users/${ana.id}`)
      .send({ name: 'Ana Lima', phone: '+5532988887777', password: '' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Ana Lima', phone: '+5532988887777' });
    await loginAs(app, 'ana', PASSWORD);
    // A sessão atual da Ana continua valendo (a senha não mudou)
    expect((await user.get('/api/auth/me')).status).toBe(200);
  });

  test('admin redefine a senha: sessões abertas do usuário caem', async () => {
    const res = await master.put(`/api/users/${ana.id}`).send({ password: 'nova-senha' });
    expect(res.status).toBe(200);
    expect((await user.get('/api/auth/me')).status).toBe(401);
    await loginAs(app, 'ana', 'nova-senha');
  });

  test('id inexistente ou inválido → 404', async () => {
    expect((await master.put('/api/users/99999').send({ name: 'X' })).status).toBe(404);
    expect((await master.put('/api/users/abc').send({ name: 'X' })).status).toBe(404);
  });
});

describe('DELETE /api/users/:id', () => {
  test('exclui o usuário com as atividades (cascade) e derruba a sessão dele', async () => {
    await createActivity(db.prisma, ana.id);
    const res = await master.delete(`/api/users/${ana.id}`);
    expect(res.status).toBe(204);
    expect(await db.prisma.activity.count({ where: { userId: ana.id } })).toBe(0);
    expect((await user.get('/api/auth/me')).status).toBe(401);
  });

  test('não exclui a si mesmo nem um admin master', async () => {
    const self = await master.delete(`/api/users/${admin.id}`);
    expect(self.status).toBe(400);
    expect(self.body.error).toBe('Você não pode excluir o próprio usuário');

    const other = await createUser(db.prisma, { username: 'outro-master', isMaster: true });
    const res = await master.delete(`/api/users/${other.id}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('O administrador master não pode ser excluído');
  });

  test('inexistente → 404', async () => {
    expect((await master.delete('/api/users/99999')).status).toBe(404);
  });
});

describe('Meu perfil', () => {
  test('GET devolve o próprio usuário', async () => {
    const res = await user.get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: ana.id, username: 'ana' });
  });

  test('altera o telefone; nome, usuário e isMaster são ignorados', async () => {
    const res = await user.put('/api/profile').send({
      phone: '(32) 3',
    });
    expect(res.status).toBe(400);
    expect(res.body.fields.phone).toBeTruthy();

    const ok = await user
      .put('/api/profile')
      .send({ phone: '+55 32 99999-0000', name: 'Hacker', username: 'root', isMaster: true });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({
      phone: '+5532999990000',
      name: 'ana',
      username: 'ana',
      isMaster: false,
    });
  });

  test('trocar a senha exige a senha atual correta', async () => {
    const missing = await user.put('/api/profile').send({ newPassword: 'nova-senha' });
    expect(missing.status).toBe(400);
    expect(missing.body.fields.currentPassword).toBe('Informe a senha atual');

    const wrong = await user
      .put('/api/profile')
      .send({ currentPassword: 'errada', newPassword: 'nova-senha' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.fields.currentPassword).toBe('Senha atual incorreta');
  });

  test('trocar a senha: esta sessão continua, as outras caem', async () => {
    const otherDevice = await loginAs(app, 'ana');
    const res = await user
      .put('/api/profile')
      .send({ currentPassword: PASSWORD, newPassword: 'nova-senha' });
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).not.toBeNull();

    expect((await user.get('/api/auth/me')).status).toBe(200);
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    await loginAs(app, 'ana', 'nova-senha');
    await expect(loginAs(app, 'ana', PASSWORD)).rejects.toThrow();
  });

  test('rate limit na troca de senha: 5 erros por minuto por usuário', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await user
        .put('/api/profile')
        .send({ currentPassword: 'errada', newPassword: 'nova-senha' });
      expect(res.status).toBe(400);
    }
    const blocked = await user
      .put('/api/profile')
      .send({ currentPassword: PASSWORD, newPassword: 'nova-senha' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Muitas tentativas de alterar a senha/);

    // Mudar só o telefone não passa pelo limite
    expect((await user.put('/api/profile').send({ phone: '' })).status).toBe(200);
  });
});

test('sem login não há perfil', async () => {
  expect((await request(app).put('/api/profile').send({ phone: '' })).status).toBe(401);
});
