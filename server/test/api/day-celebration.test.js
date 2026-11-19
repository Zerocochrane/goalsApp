// API: confete ao concluir todas as atividades do dia (diaConcluidoParaComemorar).
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-day-celebration');
const { buildApp, createUser, createActivity, createOccurrence, loginAs, today, addDays } =
  await import('../helpers/api.js');
const { dayCelebrationPending, celebrateDay } = await import('../../src/day/celebration.js');

const app = buildApp();
let ana, asAna, asBia;

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  ana = await createUser(db.prisma, { username: 'ana' });
  await createUser(db.prisma, { username: 'bia' });
  asAna = await loginAs(app, 'ana');
  asBia = await loginAs(app, 'bia');
});

/** Ocorrência de hoje da Ana, dentro da janela de 1 hora (validável agora). */
async function openOccurrence(name, overrides = {}) {
  const activity = await createActivity(db.prisma, ana.id, { name });
  const now = Date.now();
  return createOccurrence(db.prisma, activity, today(), {
    scheduledAt: new Date(now - 10 * 60 * 1000),
    expiresAt: new Date(now + 50 * 60 * 1000),
    ...overrides,
  });
}

const validate = (agent, token) => agent.post(`/api/occurrences/validate/${token}`);
const pending = async (agent) => (await agent.get('/api/streak')).body.diaConcluidoParaComemorar;

describe('diaConcluidoParaComemorar', () => {
  test('só sinaliza ao concluir a última atividade de hoje', async () => {
    const academia = await openOccurrence('Academia');
    const leitura = await openOccurrence('Leitura');

    const first = await validate(asAna, academia.token);
    expect(first.status).toBe(200);
    expect(first.body.diaConcluidoParaComemorar).toBe(false);
    expect(await pending(asAna)).toBe(false);

    const last = await validate(asAna, leitura.token);
    expect(last.status).toBe(200);
    expect(last.body.diaConcluidoParaComemorar).toBe(true);
    expect(await pending(asAna)).toBe(true);
  });

  test('uma vez por dia: depois de POST /api/day/celebrate não sinaliza mais', async () => {
    const occ = await openOccurrence('Academia');
    await validate(asAna, occ.token);
    expect(await pending(asAna)).toBe(true);

    const res = await asAna.post('/api/day/celebrate');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ comemorado: true, diaConcluidoParaComemorar: false });
    expect(await pending(asAna)).toBe(false);
    // Em outro aparelho (outra sessão) também não
    expect(await pending(await loginAs(app, 'ana'))).toBe(false);
    const user = await db.prisma.user.findUnique({ where: { id: ana.id } });
    expect(user.lastDayCelebrated).toBe(today());
  });

  test('comemorado ontem não impede hoje', async () => {
    await db.prisma.user.update({
      where: { id: ana.id },
      data: { lastDayCelebrated: addDays(today(), -1) },
    });
    const occ = await openOccurrence('Academia');
    expect((await validate(asAna, occ.token)).body.diaConcluidoParaComemorar).toBe(true);
  });

  test('não sinaliza sem atividades hoje', async () => {
    expect(await pending(asAna)).toBe(false);
    const res = await asAna.post('/api/day/celebrate');
    expect(res.body.comemorado).toBe(false);
    const user = await db.prisma.user.findUnique({ where: { id: ana.id } });
    expect(user.lastDayCelebrated).toBeNull();
  });

  test('não sinaliza se alguma atividade de hoje falhou', async () => {
    await openOccurrence('Leitura', { status: 'falhou' });
    const occ = await openOccurrence('Academia');
    expect((await validate(asAna, occ.token)).body.diaConcluidoParaComemorar).toBe(false);
    expect(await pending(asAna)).toBe(false);
    expect((await asAna.post('/api/day/celebrate')).body.comemorado).toBe(false);
  });

  test('não sinaliza por dias passados concluídos', async () => {
    const yesterday = addDays(today(), -1);
    const activity = await createActivity(db.prisma, ana.id, {
      startDate: yesterday,
      endDate: yesterday,
    });
    await createOccurrence(db.prisma, activity, yesterday, { status: 'concluida' });
    expect(await pending(asAna)).toBe(false);
  });

  test('não mistura usuários', async () => {
    const occ = await openOccurrence('Academia');
    await validate(asAna, occ.token);
    expect(await pending(asBia)).toBe(false);
  });

  test('virada do dia no fuso de São Paulo', async () => {
    // 23:30 de 19/11 em São Paulo = 02:30 de 20/11 em UTC
    const lateNight = new Date('2026-11-20T02:30:00Z');
    const activity = await createActivity(db.prisma, ana.id, { startDate: '2026-11-19' });
    await createOccurrence(db.prisma, activity, '2026-11-19', { status: 'concluida' });

    expect(await dayCelebrationPending(ana.id, lateNight)).toBe(true);
    expect(await celebrateDay(ana.id, lateNight)).toBe(true);
    expect(await dayCelebrationPending(ana.id, lateNight)).toBe(false);
    const user = await db.prisma.user.findUnique({ where: { id: ana.id } });
    expect(user.lastDayCelebrated).toBe('2026-11-19');

    // 00:30 de 20/11 em São Paulo: novo dia, atividade de hoje ainda pendente
    const nextDay = new Date('2026-11-20T03:30:00Z');
    expect(await dayCelebrationPending(ana.id, nextDay)).toBe(false);
    await createOccurrence(db.prisma, activity, '2026-11-20', { status: 'concluida' });
    expect(await dayCelebrationPending(ana.id, nextDay)).toBe(true);
  });
});
