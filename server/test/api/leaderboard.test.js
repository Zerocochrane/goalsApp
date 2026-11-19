// API: ranking entre amigos (issue #29) — só amigos aceitos, só números agregados.
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-leaderboard');
const { buildApp, createUser, createActivity, createOccurrence, loginAs, today, addDays } =
  await import('../helpers/api.js');
const { pairKey } = await import('../../src/friends/routes.js');

const app = buildApp();
let ana, bia, caio, davi, asAna;

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  ana = await createUser(db.prisma, { username: 'ana', name: 'Ana Lima', phone: '+5532999990001' });
  bia = await createUser(db.prisma, { username: 'bia', name: 'Bia Souza' });
  caio = await createUser(db.prisma, { username: 'caio', name: 'Caio' }); // pedido pendente
  davi = await createUser(db.prisma, { username: 'davi', name: 'Davi' }); // não é amigo
  asAna = await loginAs(app, 'ana');

  await befriend(ana, bia, 'aceita');
  await befriend(caio, ana, 'pendente');
});

function befriend(requester, addressee, status) {
  return db.prisma.friendship.create({
    data: {
      requesterId: requester.id,
      addresseeId: addressee.id,
      pairKey: pairKey(requester.id, addressee.id),
      status,
    },
  });
}

/** Atividade diária desde `daysAgo` dias atrás, com o status de cada dia passado. */
async function history(user, statuses, name = 'Academia') {
  const start = addDays(today(), -statuses.length);
  const activity = await createActivity(db.prisma, user.id, { name, startDate: start });
  for (const [i, status] of statuses.entries()) {
    await createOccurrence(db.prisma, activity, addDays(start, i), { status });
  }
  // Hoje: pendente e ainda no prazo (não conta como falha)
  await createOccurrence(db.prisma, activity, today(), {
    status: 'pendente',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return activity;
}

const get = (periodo) => asAna.get(`/api/leaderboard${periodo ? `?periodo=${periodo}` : ''}`);

describe('GET /api/leaderboard', () => {
  test('exige login e período válido', async () => {
    const { default: request } = await import('supertest');
    expect((await request(app).get('/api/leaderboard')).status).toBe(401);
    const bad = await get('ano');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Período inválido/);
  });

  test('só aparecem o usuário e amigos aceitos (pendentes e não amigos ficam de fora)', async () => {
    await history(caio, ['concluida']);
    await history(davi, ['concluida']);
    for (const periodo of ['semana', 'mes', 'sequencia']) {
      const res = await get(periodo);
      expect(res.status).toBe(200);
      expect(res.body.map((e) => e.usuario.username).sort()).toEqual(['ana', 'bia']);
      expect(res.body.find((e) => e.usuario.username === 'ana').voce).toBe(true);
      expect(res.body.find((e) => e.usuario.username === 'bia').voce).toBe(false);
    }
  });

  test('sem amigos: só o próprio usuário', async () => {
    await db.prisma.friendship.deleteMany();
    const res = await get('semana');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].voce).toBe(true);
  });

  test('ranking por sequência, com desempate e sem atividades no fim', async () => {
    await history(ana, ['concluida', 'concluida', 'falhou', 'concluida', 'concluida']);
    await history(bia, ['concluida', 'concluida', 'concluida', 'concluida', 'concluida']);
    const res = await get('sequencia');
    expect(res.body.map((e) => [e.usuario.username, e.posicao, e.sequencia])).toEqual([
      ['bia', 1, 5],
      ['ana', 2, 2],
    ]);
    expect(res.body[1].melhorSequencia).toBe(2);

    // Igual ao contador do topo
    const streak = await asAna.get('/api/streak');
    expect(streak.body.atual).toBe(2);
  });

  test('quem não tem atividades no período fica no fim, sem posição', async () => {
    await history(ana, ['falhou']);
    const res = await get('semana');
    const ontemNaSemana = addDays(today(), -1) >= startOfWeek(today());
    if (ontemNaSemana) {
      expect(res.body.map((e) => [e.usuario.username, e.posicao, e.percentual])).toEqual([
        ['ana', 1, 0],
        ['bia', null, null],
      ]);
    } else {
      // Segunda-feira: ontem foi a semana passada, então ninguém tem nada vencido
      expect(res.body.map((e) => e.posicao)).toEqual([null, null]);
    }
  });

  test('percentual e totais do mês; pendente de hoje no prazo não conta', async () => {
    const dayOfMonth = Number(today().slice(8, 10));
    // Histórico só dentro do mês: até ontem (ou nada, se hoje é dia 1º)
    const statuses = Array.from({ length: dayOfMonth - 1 }, (_, i) =>
      i % 2 === 0 ? 'concluida' : 'falhou',
    );
    await history(ana, statuses);
    const res = await get('mes');
    const me = res.body.find((e) => e.voce);
    const done = statuses.filter((s) => s === 'concluida').length;
    expect(me.total).toBe(statuses.length);
    expect(me.concluidas).toBe(done);
    expect(me.diasConcluidos).toBe(done);
    expect(me.percentual).toBe(statuses.length ? Math.floor((done * 100) / statuses.length) : null);
  });

  test('empates dividem a posição', async () => {
    await history(ana, ['concluida', 'concluida']);
    await history(bia, ['concluida', 'concluida']);
    const res = await get('sequencia');
    expect(res.body.map((e) => [e.usuario.username, e.posicao])).toEqual([
      ['ana', 1],
      ['bia', 1],
    ]);
  });

  test('privacidade: só números agregados, nunca atividades, horários ou telefone', async () => {
    await history(bia, ['concluida', 'falhou'], 'Remédio secreto');
    for (const periodo of ['semana', 'mes', 'sequencia']) {
      const res = await get(periodo);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/Remédio secreto|07:30|\+5532|phone|token|activit/i);
      for (const e of res.body) {
        expect(Object.keys(e).sort()).toEqual(
          [
            'concluidas',
            'diasConcluidos',
            'melhorSequencia',
            'percentual',
            'posicao',
            'sequencia',
            'total',
            'usuario',
            'voce',
          ].sort(),
        );
        expect(Object.keys(e.usuario).sort()).toEqual(['id', 'nome', 'username']);
      }
    }
  });
});

function startOfWeek(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
