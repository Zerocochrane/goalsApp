// API: lista de amigos (issue #28) — pedidos, aceitar/recusar/cancelar, desfazer,
// duplicidade e privacidade dos dados do amigo.
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-friends');
const { buildApp, createUser, createActivity, createOccurrence, loginAs, today, addDays } =
  await import('../helpers/api.js');

const app = buildApp();
let ana, bia, asAna, asBia, asCaio;

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  ana = await createUser(db.prisma, { username: 'ana', name: 'Ana Lima', phone: '+5532999990001' });
  bia = await createUser(db.prisma, {
    username: 'bia',
    name: 'Bia Souza',
    phone: '+5532999990002',
  });
  await createUser(db.prisma, { username: 'caio', name: 'Caio' });
  asAna = await loginAs(app, 'ana');
  asBia = await loginAs(app, 'bia');
  asCaio = await loginAs(app, 'caio');
});

async function sendRequest(agent, username) {
  const res = await agent.post('/api/friends/requests').send({ username });
  return res;
}

async function makeFriends(from, to, toUsername) {
  const sent = await sendRequest(from, toUsername);
  expect(sent.status).toBe(201);
  const accepted = await to.post(`/api/friends/requests/${sent.body.pedido.id}/accept`);
  expect(accepted.status).toBe(200);
  return sent.body.pedido.id;
}

describe('fluxo do pedido', () => {
  test('pedido → aceitar: os dois se veem na lista um do outro', async () => {
    const sent = await sendRequest(asAna, '@Bia');
    expect(sent.status).toBe(201);
    expect(sent.body.pedido.user).toEqual({ id: bia.id, name: 'Bia Souza', username: 'bia' });

    // Pendente: aparece em "enviados" para Ana e "recebidos" para Bia
    let anaList = (await asAna.get('/api/friends')).body;
    let biaList = (await asBia.get('/api/friends')).body;
    expect(anaList.enviados.map((p) => p.user.username)).toEqual(['bia']);
    expect(anaList.recebidos).toEqual([]);
    expect(biaList.recebidos.map((p) => p.user.username)).toEqual(['ana']);
    expect((await asBia.get('/api/friends/pending')).body).toEqual({ recebidos: 1 });
    expect((await asAna.get('/api/friends/pending')).body).toEqual({ recebidos: 0 });

    // Só quem recebeu aceita
    const id = sent.body.pedido.id;
    expect((await asAna.post(`/api/friends/requests/${id}/accept`)).status).toBe(404);
    expect((await asCaio.post(`/api/friends/requests/${id}/accept`)).status).toBe(404);
    const accepted = await asBia.post(`/api/friends/requests/${id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.amigo.username).toBe('ana');

    anaList = (await asAna.get('/api/friends')).body;
    biaList = (await asBia.get('/api/friends')).body;
    expect(anaList.amigos.map((f) => f.username)).toEqual(['bia']);
    expect(biaList.amigos.map((f) => f.username)).toEqual(['ana']);
    expect(anaList.enviados).toEqual([]);
    expect(biaList.recebidos).toEqual([]);
    expect((await asBia.get('/api/friends/pending')).body).toEqual({ recebidos: 0 });

    // Caio não tem nada a ver com isso
    expect((await asCaio.get('/api/friends')).body).toEqual({
      amigos: [],
      recebidos: [],
      enviados: [],
    });
  });

  test('recusar: só quem recebeu; o pedido some e pode ser refeito', async () => {
    const { id } = (await sendRequest(asAna, 'bia')).body.pedido;
    expect((await asAna.post(`/api/friends/requests/${id}/decline`)).status).toBe(404);
    expect((await asBia.post(`/api/friends/requests/${id}/decline`)).status).toBe(204);

    expect((await asAna.get('/api/friends')).body.enviados).toEqual([]);
    expect((await asBia.get('/api/friends')).body.recebidos).toEqual([]);
    expect((await asBia.post(`/api/friends/requests/${id}/accept`)).status).toBe(404);
    expect((await sendRequest(asAna, 'bia')).status).toBe(201);
  });

  test('cancelar: só quem enviou', async () => {
    const { id } = (await sendRequest(asAna, 'bia')).body.pedido;
    const byOther = await asBia.delete(`/api/friends/requests/${id}`);
    expect(byOther.status).toBe(404);
    expect(byOther.body.error).toBe('Pedido de amizade não encontrado');

    expect((await asAna.delete(`/api/friends/requests/${id}`)).status).toBe(204);
    expect((await asBia.get('/api/friends')).body.recebidos).toEqual([]);
    expect((await asBia.post(`/api/friends/requests/${id}/accept`)).status).toBe(404);
  });

  test('desfazer amizade: qualquer um dos dois', async () => {
    await makeFriends(asAna, asBia, 'bia');
    expect((await asCaio.delete(`/api/friends/${ana.id}`)).status).toBe(404);

    const res = await asBia.delete(`/api/friends/${ana.id}`);
    expect(res.status).toBe(204);
    expect((await asAna.get('/api/friends')).body.amigos).toEqual([]);
    expect((await asBia.get('/api/friends')).body.amigos).toEqual([]);

    const again = await asAna.delete(`/api/friends/${bia.id}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('Amizade não encontrada');
    // Pode virar amigo de novo
    await makeFriends(asBia, asAna, 'ana');
  });

  test('desfazer não apaga um pedido pendente', async () => {
    await sendRequest(asAna, 'bia');
    expect((await asAna.delete(`/api/friends/${bia.id}`)).status).toBe(404);
    expect((await asBia.get('/api/friends')).body.recebidos).toHaveLength(1);
  });
});

describe('validações', () => {
  test.each([
    ['', 400, 'Informe o @usuário do seu amigo'],
    ['ninguem', 404, 'Usuário não encontrado'],
    ['nome com espaço', 404, 'Usuário não encontrado'],
  ])('username %j → %i', async (username, status, error) => {
    const res = await sendRequest(asAna, username);
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
    expect(res.body.fields.username).toBe(error);
  });

  test('não adiciona a si mesmo', async () => {
    const res = await sendRequest(asAna, 'ana');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Você não pode adicionar a si mesmo');
  });

  test('sem duplicidade, nos dois sentidos', async () => {
    await sendRequest(asAna, 'bia');
    const twice = await sendRequest(asAna, 'BIA');
    expect(twice.status).toBe(409);
    expect(twice.body.error).toBe('Você já enviou um pedido para @bia');

    const reverse = await sendRequest(asBia, 'ana');
    expect(reverse.status).toBe(409);
    expect(reverse.body.error).toMatch(/já te enviou um pedido/);

    expect(await db.prisma.friendship.count()).toBe(1);
  });

  test('já amigos → 409', async () => {
    await makeFriends(asAna, asBia, 'bia');
    for (const [agent, username] of [
      [asAna, 'bia'],
      [asBia, 'ana'],
    ]) {
      const res = await sendRequest(agent, username);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Vocês já são amigos');
    }
  });

  test('ids inválidos → 404', async () => {
    for (const url of ['/api/friends/requests/abc/accept', '/api/friends/requests/-1/decline']) {
      expect((await asAna.post(url)).status).toBe(404);
    }
    expect((await asAna.delete('/api/friends/requests/0')).status).toBe(404);
    expect((await asAna.delete('/api/friends/xyz')).status).toBe(404);
  });

  test('exige login', async () => {
    const { default: request } = await import('supertest');
    expect((await request(app).get('/api/friends')).status).toBe(401);
    expect(
      (await request(app).post('/api/friends/requests').send({ username: 'ana' })).status,
    ).toBe(401);
  });
});

describe('privacidade', () => {
  test('amigo vê só nome, @usuário e progresso agregado', async () => {
    // Bia tem 2 dias concluídos seguidos (anteontem e ontem)
    const activity = await createActivity(db.prisma, bia.id, {
      name: 'Remédio secreto',
      startDate: addDays(today(), -2),
    });
    for (const date of [addDays(today(), -2), addDays(today(), -1)]) {
      await createOccurrence(db.prisma, activity, date, {
        status: 'concluida',
        completedAt: new Date(),
      });
    }
    await makeFriends(asAna, asBia, 'bia');

    const res = await asAna.get('/api/friends');
    expect(res.status).toBe(200);
    const [friend] = res.body.amigos;
    expect(Object.keys(friend).sort()).toEqual(
      ['amigosDesde', 'atual', 'diasConcluidos', 'id', 'name', 'username'].sort(),
    );
    expect(friend).toMatchObject({
      username: 'bia',
      name: 'Bia Souza',
      atual: 2,
      diasConcluidos: 2,
    });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('+55');
    expect(body).not.toContain('Remédio secreto');
    expect(body).not.toMatch(/phone|passwordHash|isMaster|hour|minute|activities/);

    // Pedidos também não expõem dados privados
    await sendRequest(asCaio, 'bia');
    const pending = JSON.stringify((await asBia.get('/api/friends')).body);
    expect(pending).not.toMatch(/phone|\+55|passwordHash/);
  });

  test('amizade não dá acesso às atividades do amigo', async () => {
    const activity = await createActivity(db.prisma, bia.id);
    await makeFriends(asAna, asBia, 'bia');
    expect((await asAna.get(`/api/activities/${activity.id}`)).status).toBe(404);
    const calendar = await asAna.get('/api/calendar');
    expect(JSON.stringify(calendar.body)).not.toContain(String(activity.name));
  });
});

test('excluir um usuário remove as amizades e pedidos dele', async () => {
  await makeFriends(asAna, asBia, 'bia');
  await sendRequest(asCaio, 'bia');

  await db.prisma.user.delete({ where: { id: bia.id } });
  expect(await db.prisma.friendship.count()).toBe(0);
  expect((await asAna.get('/api/friends')).body.amigos).toEqual([]);
  expect((await asCaio.get('/api/friends')).body.enviados).toEqual([]);
});

test('rate limit nos pedidos', async () => {
  await createUser(db.prisma, { username: 'dave' });
  const asDave = await loginAs(app, 'dave');
  let last;
  for (let i = 0; i < 21; i += 1) last = await sendRequest(asDave, `ninguem${i}`);
  expect(last.status).toBe(429);
  expect(last.body.error).toMatch(/Muitos pedidos de amizade/);
});
