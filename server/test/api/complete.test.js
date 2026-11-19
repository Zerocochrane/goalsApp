// API: concluir a atividade de hoje pelo site (POST /api/activities/:id/complete),
// com relógio simulado (só o Date é falso; timers e I/O continuam reais).
import { describe, test, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-complete');
const { buildApp, createUser, createActivity, createOccurrence, loginAs, addDays } =
  await import('../helpers/api.js');
const { zonedDateTime } = await import('../../src/activities/recurrence.js');

const app = buildApp();
const DAY = '2026-11-18'; // quarta-feira
const at = (hh, mm, ss = 0) => new Date(zonedDateTime(DAY, hh, mm).getTime() + ss * 1000);
const setClock = (date) => vi.setSystemTime(date);

let ana, asAna, asBia, activity;

afterAll(() => db.destroy());
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock(at(6, 0));
  await db.reset();
  ana = await createUser(db.prisma, { username: 'ana' });
  await createUser(db.prisma, { username: 'bia' });
  asAna = await loginAs(app, 'ana');
  asBia = await loginAs(app, 'bia');
  // Academia às 07:30, todos os dias, valendo desde ontem
  activity = await createActivity(db.prisma, ana.id, {
    startDate: addDays(DAY, -1),
    createdAt: at(5, 0),
    updatedAt: at(5, 0),
  });
});

const complete = (agent, id = activity.id) => agent.post(`/api/activities/${id}/complete`);
const occurrenceToday = () =>
  db.prisma.taskOccurrence.findUnique({
    where: { activityId_date: { activityId: activity.id, date: DAY } },
  });
const todayItem = async (agent = asAna) => {
  const res = await agent.get(`/api/calendar?start=${DAY}&end=${DAY}`);
  return { body: res.body, item: res.body.days[0].activities[0] };
};

describe('POST /api/activities/:id/complete — horário', () => {
  test('antes do horário: 409 e nada é criado', async () => {
    setClock(at(7, 29, 59));
    const res = await complete(asAna);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'antes_do_horario',
      error: 'Esta atividade só pode ser concluída a partir das 07:30.',
    });
    expect(await occurrenceToday()).toBeNull();
  });

  test('antes do horário com a ocorrência já criada: 409 e continua pendente', async () => {
    await createOccurrence(db.prisma, activity, DAY);
    setClock(at(7, 0));
    const res = await complete(asAna);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('antes_do_horario');
    expect((await occurrenceToday()).status).toBe('pendente');
  });

  test('no horário, sem ocorrência (agendador atrasado): cria e conclui', async () => {
    setClock(at(7, 30));
    const res = await complete(asAna);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: 'concluida',
      message: 'Atividade concluída!',
      diaConcluidoParaComemorar: true,
      occurrence: { activityId: activity.id, date: DAY, status: 'concluida' },
    });
    const occ = await occurrenceToday();
    expect(occ.status).toBe('concluida');
    expect(occ.scheduledAt).toEqual(at(7, 30));
    expect(occ.expiresAt).toEqual(at(8, 30));
    expect(occ.completedAt).toEqual(at(7, 30));
  });

  test('no último minuto do prazo: conclui', async () => {
    await createOccurrence(db.prisma, activity, DAY);
    setClock(at(8, 29, 59));
    const res = await complete(asAna);
    expect(res.status).toBe(200);
    expect((await occurrenceToday()).status).toBe('concluida');
  });

  test('após 1h: 410 e a ocorrência fica falhou', async () => {
    await createOccurrence(db.prisma, activity, DAY);
    setClock(at(8, 30));
    const res = await complete(asAna);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      code: 'prazo_encerrado',
      error: 'O prazo para concluir esta atividade terminou às 08:30.',
    });
    expect((await occurrenceToday()).status).toBe('falhou');
  });

  test('após 1h sem ocorrência: cria já como falhou e responde 410', async () => {
    setClock(at(9, 0));
    const res = await complete(asAna);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('prazo_encerrado');
    expect((await occurrenceToday()).status).toBe('falhou');
    // Tentar de novo continua recusando
    expect((await complete(asAna)).status).toBe(410);
  });

  test('atividade criada depois do horário de hoje: não vale para hoje (404)', async () => {
    const late = await createActivity(db.prisma, ana.id, {
      name: 'Leitura',
      startDate: DAY,
      createdAt: at(10, 0),
      updatedAt: at(10, 0),
    });
    setClock(at(10, 5));
    const res = await complete(asAna, late.id);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/activities/:id/complete — dono, dia e repetição', () => {
  test('atividade de outro usuário: 404 e não toca na ocorrência', async () => {
    await createOccurrence(db.prisma, activity, DAY);
    setClock(at(7, 40));
    const res = await complete(asBia);
    expect(res.status).toBe(404);
    expect((await occurrenceToday()).status).toBe('pendente');
  });

  test('atividade que não acontece hoje (só ontem / só amanhã): 404', async () => {
    const yesterday = await createActivity(db.prisma, ana.id, {
      name: 'Ontem',
      startDate: addDays(DAY, -1),
      endDate: addDays(DAY, -1),
      createdAt: at(5, 0),
    });
    const tomorrow = await createActivity(db.prisma, ana.id, {
      name: 'Amanhã',
      startDate: addDays(DAY, 1),
      createdAt: at(5, 0),
    });
    setClock(at(7, 40));
    expect((await complete(asAna, yesterday.id)).status).toBe(404);
    expect((await complete(asAna, tomorrow.id)).status).toBe(404);
    expect((await complete(asAna, 999999)).status).toBe(404);
    expect((await complete(asAna, 'abc')).status).toBe(404);
  });

  test('a ocorrência de ontem ainda pendente não é concluída', async () => {
    await createOccurrence(db.prisma, activity, addDays(DAY, -1), {
      expiresAt: at(23, 0), // prazo artificialmente aberto
    });
    setClock(at(7, 0)); // hoje, antes do horário
    const res = await complete(asAna);
    expect(res.status).toBe(409);
    const old = await db.prisma.taskOccurrence.findUnique({
      where: { activityId_date: { activityId: activity.id, date: addDays(DAY, -1) } },
    });
    expect(old.status).toBe('pendente');
  });

  test('concluída duas vezes: a segunda responde 409 "já validada"', async () => {
    setClock(at(7, 45));
    expect((await complete(asAna)).status).toBe(200);
    const res = await complete(asAna);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'ja_validado',
      error: 'Esta atividade já foi validada.',
    });
  });

  test('concluída pelo link e depois pelo site (e vice-versa)', async () => {
    const occ = await createOccurrence(db.prisma, activity, DAY);
    setClock(at(7, 45));
    expect((await asAna.post(`/api/occurrences/validate/${occ.token}`)).status).toBe(200);
    const bySite = await complete(asAna);
    expect(bySite.status).toBe(409);
    expect(bySite.body.code).toBe('ja_validado');

    // Outra atividade: primeiro pelo site, depois pelo link
    const other = await createActivity(db.prisma, ana.id, {
      name: 'Leitura',
      startDate: addDays(DAY, -1),
      createdAt: at(5, 0),
    });
    const otherOcc = await createOccurrence(db.prisma, other, DAY);
    expect((await complete(asAna, other.id)).status).toBe(200);
    const byLink = await asAna.post(`/api/occurrences/validate/${otherOcc.token}`);
    expect(byLink.status).toBe(409);
    expect(byLink.body.error).toBe('Esta atividade já foi validada.');
  });

  test('cliques simultâneos concluem uma vez só', async () => {
    setClock(at(7, 45));
    const results = await Promise.all([complete(asAna), complete(asAna), complete(asAna)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(await db.prisma.taskOccurrence.count()).toBe(1);
  });

  test('versão encerrada hoje (editada depois do envio) ainda conclui a ocorrência de hoje', async () => {
    await createOccurrence(db.prisma, activity, DAY, { notifiedAt: at(7, 30) });
    await db.prisma.activity.update({
      where: { id: activity.id },
      data: { active: false, endDate: DAY },
    });
    setClock(at(7, 50));
    expect((await complete(asAna)).status).toBe(200);
  });
});

describe('GET /api/calendar — campos de conclusão de hoje', () => {
  test('antes, durante e depois da janela', async () => {
    setClock(at(7, 0));
    let { body, item } = await todayItem();
    expect(body.now).toBe(at(7, 0).toISOString());
    expect(item).toMatchObject({
      podeConcluir: false,
      disponivelEm: at(7, 30).toISOString(),
      prazoAte: at(8, 30).toISOString(),
    });

    setClock(at(7, 30));
    ({ item } = await todayItem());
    expect(item.podeConcluir).toBe(true);

    setClock(at(8, 30));
    ({ item } = await todayItem());
    expect(item).toMatchObject({ podeConcluir: false, disponivelEm: null, prazoAte: null });
  });

  test('depois de concluir: podeConcluir false', async () => {
    setClock(at(7, 40));
    await complete(asAna);
    const { item } = await todayItem();
    expect(item).toMatchObject({ status: 'concluida', podeConcluir: false, disponivelEm: null });
  });

  test('outros dias não recebem os campos', async () => {
    setClock(at(7, 40));
    const res = await asAna.get(`/api/calendar?start=${addDays(DAY, -1)}&end=${addDays(DAY, 1)}`);
    const [yesterday, today, tomorrow] = res.body.days;
    expect(today.activities[0].podeConcluir).toBe(true);
    expect(yesterday.activities[0]).not.toHaveProperty('podeConcluir');
    expect(tomorrow.activities[0]).not.toHaveProperty('podeConcluir');
  });
});
