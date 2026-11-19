// API: validação pelo link do WhatsApp e sequência (streak).
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-occurrences');
const { buildApp, createUser, createActivity, createOccurrence, loginAs, today, addDays } =
  await import('../helpers/api.js');

const app = buildApp();
const HOUR = 60 * 60 * 1000;
let ana, asAna, asBia;

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  ana = await createUser(db.prisma, { username: 'ana' });
  await createUser(db.prisma, { username: 'bia' });
  asAna = await loginAs(app, 'ana');
  asBia = await loginAs(app, 'bia');
});

/** Ocorrência de hoje da Ana, dentro da janela de 1 hora. */
async function openOccurrence(overrides = {}) {
  const activity = await createActivity(db.prisma, ana.id, { name: 'Academia' });
  const now = Date.now();
  return createOccurrence(db.prisma, activity, today(), {
    scheduledAt: new Date(now - 10 * 60 * 1000),
    expiresAt: new Date(now + 50 * 60 * 1000),
    ...overrides,
  });
}

const validate = (agent, token) => agent.post(`/api/occurrences/validate/${token}`);
const reload = (occ) => db.prisma.taskOccurrence.findUnique({ where: { id: occ.id } });
const calendarToday = async (agent) =>
  (await agent.get(`/api/calendar?start=${today()}&end=${today()}`)).body.days[0];

describe('POST /api/occurrences/validate/:token', () => {
  test('dentro do prazo: conclui, e a atividade e o dia ficam verdes', async () => {
    const occ = await openOccurrence();
    const res = await validate(asAna, occ.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: 'concluida',
      message: 'Atividade concluída! 🎉',
      occurrence: { id: occ.id, activityName: 'Academia', date: today() },
    });
    expect(res.body.occurrence.completedAt).toBeTruthy();
    expect((await reload(occ)).status).toBe('concluida');

    const day = await calendarToday(asAna);
    expect(day.status).toBe('concluido');
    expect(day.activities[0].status).toBe('concluida');
  });

  test('segundo clique → 409 "já validada"', async () => {
    const occ = await openOccurrence();
    await validate(asAna, occ.token);
    const res = await validate(asAna, occ.token);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'ja_validado',
      error: 'Esta atividade já foi validada.',
    });
  });

  test('link expirado: 410 e a atividade e o dia ficam vermelhos', async () => {
    const occ = await openOccurrence({
      scheduledAt: new Date(Date.now() - 2 * HOUR),
      expiresAt: new Date(Date.now() - HOUR),
    });
    const res = await validate(asAna, occ.token);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      code: 'expirado',
      error: 'Este link expirou. A atividade foi marcada como não realizada.',
    });
    expect((await reload(occ)).status).toBe('falhou');

    const day = await calendarToday(asAna);
    expect(day.status).toBe('falhou');
    expect(day.activities[0].status).toBe('falhou');
  });

  test('link de outra pessoa → 403 sem revelar a atividade nem concluir', async () => {
    const occ = await openOccurrence();
    const res = await validate(asBia, occ.token);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'outro_usuario', occurrence: null });
    expect((await reload(occ)).status).toBe('pendente');
  });

  test('token inexistente ou longo demais → 404', async () => {
    expect((await validate(asAna, 'nao-existe')).status).toBe(404);
    expect((await validate(asAna, 'x'.repeat(129))).body.code).toBe('invalido');
  });
});

describe('GET/POST /api/streak', () => {
  /** Ana com `days` dias seguidos concluídos até ontem. */
  async function streakOf(days) {
    const start = addDays(today(), -days);
    const activity = await createActivity(db.prisma, ana.id, { startDate: start });
    for (let i = 0; i < days; i++) {
      await createOccurrence(db.prisma, activity, addDays(start, i), { status: 'concluida' });
    }
    return activity;
  }

  test('sem atividades → 0', async () => {
    const res = await asAna.get('/api/streak');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      atual: 0,
      ultimoMarcoComemorado: 0,
      marcoPendente: null,
      diaConcluidoParaComemorar: false,
    });
  });

  test('conta dias seguidos concluídos; hoje pendente não quebra', async () => {
    await streakOf(3);
    expect((await asAna.get('/api/streak')).body.atual).toBe(3);
  });

  test('um dia com falha quebra a sequência', async () => {
    const activity = await streakOf(4);
    await db.prisma.taskOccurrence.update({
      where: { activityId_date: { activityId: activity.id, date: addDays(today(), -3) } },
      data: { status: 'falhou' },
    });
    expect((await asAna.get('/api/streak')).body.atual).toBe(2);
  });

  test('não mistura a sequência de outro usuário', async () => {
    await streakOf(5);
    expect((await asBia.get('/api/streak')).body.atual).toBe(0);
  });

  test('marco de 10 dias: pendente até comemorar, e só uma vez', async () => {
    await streakOf(10);
    expect((await asAna.get('/api/streak')).body).toEqual({
      atual: 10,
      ultimoMarcoComemorado: 0,
      marcoPendente: 10,
      diaConcluidoParaComemorar: false,
    });

    const first = await asAna.post('/api/streak/celebrate');
    expect(first.body).toEqual({ atual: 10, ultimoMarcoComemorado: 10, marcoPendente: null });
    const again = await asAna.post('/api/streak/celebrate');
    expect(again.body).toEqual(first.body);
    expect((await asAna.get('/api/streak')).body.marcoPendente).toBeNull();
  });
});
