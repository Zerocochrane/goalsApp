// API: atividades (CRUD, validação, isolamento entre usuários) e calendário.
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';

const db = await createTestDatabase('api-activities');
const { buildApp, createUser, createActivity, createOccurrence, loginAs, today, addDays } =
  await import('../helpers/api.js');
const { weekdayOf } = await import('../../src/activities/recurrence.js');

const app = buildApp();
let ana, bia, asAna, asBia;

afterAll(() => db.destroy());
beforeEach(async () => {
  await db.reset();
  ana = await createUser(db.prisma, { username: 'ana' });
  bia = await createUser(db.prisma, { username: 'bia' });
  asAna = await loginAs(app, 'ana');
  asBia = await loginAs(app, 'bia');
});

const valid = () => ({ name: 'Academia', hour: 7, minute: 30, weekdays: [1, 3, 5] });

describe('POST /api/activities', () => {
  test('cria a partir de hoje por padrão', async () => {
    const res = await asAna.post('/api/activities').send(valid());
    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({
      name: 'Academia',
      hour: 7,
      minute: 30,
      time: '07:30',
      weekdays: [1, 3, 5],
      startDate: today(),
      endDate: null,
      active: true,
    });
  });

  test('aceita data futura, remove dias repetidos e ordena', async () => {
    const startDate = addDays(today(), 3);
    const res = await asAna
      .post('/api/activities')
      .send({ ...valid(), name: '  Ler   livro ', weekdays: [5, 1, 5], startDate });
    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({ name: 'Ler livro', weekdays: [1, 5], startDate });
  });

  test.each([
    [{ name: '' }, 'name', 'Informe o nome da atividade'],
    [{ name: 'x'.repeat(81) }, 'name', 'Nome deve ter no máximo 80 caracteres'],
    [{ hour: 24 }, 'hour', 'Hora deve ser um número de 0 a 23'],
    [{ hour: 7.5 }, 'hour', 'Hora deve ser um número de 0 a 23'],
    [{ minute: -1 }, 'minute', 'Minuto deve ser um número de 0 a 59'],
    [{ minute: '60' }, 'minute', 'Minuto deve ser um número de 0 a 59'],
    [{ weekdays: [] }, 'weekdays', 'Escolha pelo menos um dia da semana'],
    [{ weekdays: [7] }, 'weekdays', 'Dias da semana inválidos'],
    [{ weekdays: 'seg' }, 'weekdays', 'Escolha pelo menos um dia da semana'],
    [{ startDate: '2026-02-30' }, 'startDate', 'Data de início inválida (use AAAA-MM-DD)'],
  ])('validação: %j → 400', async (patch, field, message) => {
    const res = await asAna.post('/api/activities').send({ ...valid(), ...patch });
    expect(res.status).toBe(400);
    expect(res.body.fields[field]).toBe(message);
    expect(res.body.error).toBe(message);
  });

  test('não cria em dia passado', async () => {
    const res = await asAna
      .post('/api/activities')
      .send({ ...valid(), startDate: addDays(today(), -1) });
    expect(res.status).toBe(400);
    expect(res.body.fields.startDate).toBe('Não é possível criar atividades em dias passados');
  });

  test('userId do corpo é ignorado: sempre do usuário logado', async () => {
    const res = await asAna.post('/api/activities').send({ ...valid(), userId: bia.id });
    expect(res.status).toBe(201);
    const saved = await db.prisma.activity.findUnique({ where: { id: res.body.activity.id } });
    expect(saved.userId).toBe(ana.id);
  });
});

describe('leitura e isolamento', () => {
  test('cada usuário só vê, edita e exclui as próprias atividades', async () => {
    const mine = await createActivity(db.prisma, ana.id, { name: 'Da Ana' });
    await createActivity(db.prisma, bia.id, { name: 'Da Bia' });

    const list = await asAna.get('/api/activities');
    expect(list.body.activities.map((a) => a.name)).toEqual(['Da Ana']);
    expect((await asAna.get(`/api/activities/${mine.id}`)).status).toBe(200);

    expect((await asBia.get(`/api/activities/${mine.id}`)).status).toBe(404);
    expect((await asBia.put(`/api/activities/${mine.id}`).send({ name: 'Invadido' })).status).toBe(
      404,
    );
    expect((await asBia.delete(`/api/activities/${mine.id}`)).status).toBe(404);
    const after = await db.prisma.activity.findUnique({ where: { id: mine.id } });
    expect(after).toMatchObject({ name: 'Da Ana', active: true });
  });

  test('id inválido → 404', async () => {
    expect((await asAna.get('/api/activities/abc')).status).toBe(404);
    expect((await asAna.delete('/api/activities/0')).status).toBe(404);
  });

  test('lista ordenada por horário', async () => {
    await createActivity(db.prisma, ana.id, { name: 'B', hour: 9, minute: 0 });
    await createActivity(db.prisma, ana.id, { name: 'A', hour: 6, minute: 45 });
    const res = await asAna.get('/api/activities');
    expect(res.body.activities.map((a) => a.time)).toEqual(['06:45', '09:00']);
  });
});

describe('PUT /api/activities/:id', () => {
  test('atividade que ainda não valeu: altera a própria', async () => {
    const startDate = addDays(today(), 2);
    const activity = await createActivity(db.prisma, ana.id, { startDate });
    const res = await asAna
      .put(`/api/activities/${activity.id}`)
      .send({ name: 'Corrida', hour: 6, minute: 0 });
    expect(res.status).toBe(200);
    expect(res.body.activity).toMatchObject({ id: activity.id, name: 'Corrida', time: '06:00' });
    expect(res.body.previousId).toBe(activity.id);
  });

  test('atividade que já valeu: encerra a versão antiga e cria uma nova a partir de hoje', async () => {
    const activity = await createActivity(db.prisma, ana.id, { startDate: addDays(today(), -7) });
    const res = await asAna.put(`/api/activities/${activity.id}`).send({ name: 'Corrida' });
    expect(res.status).toBe(200);
    expect(res.body.activity.id).not.toBe(activity.id);
    expect(res.body.activity).toMatchObject({ name: 'Corrida', startDate: today(), active: true });

    const old = await db.prisma.activity.findUnique({ where: { id: activity.id } });
    expect(old).toMatchObject({ name: 'Academia', active: false, endDate: addDays(today(), -1) });
  });

  test('validação na edição', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await asAna.put(`/api/activities/${activity.id}`).send({ weekdays: [] });
    expect(res.status).toBe(400);
    expect(res.body.fields.weekdays).toBe('Escolha pelo menos um dia da semana');
  });
});

describe('DELETE /api/activities/:id', () => {
  test('exclusão lógica: some da lista, dias passados continuam no calendário', async () => {
    const start = addDays(today(), -3);
    const activity = await createActivity(db.prisma, ana.id, { startDate: start });
    const past = await createOccurrence(db.prisma, activity, start, { status: 'concluida' });

    expect((await asAna.delete(`/api/activities/${activity.id}`)).status).toBe(204);
    expect((await asAna.get('/api/activities')).body.activities).toEqual([]);

    const cal = await asAna.get(`/api/calendar?start=${start}&end=${today()}`);
    const first = cal.body.days[0];
    expect(first.activities).toHaveLength(1);
    expect(first.activities[0]).toMatchObject({ status: 'concluida', editable: false });
    expect(first.activities[0].occurrence.id).toBe(past.id);
    expect(cal.body.days.at(-1).activities).toEqual([]); // hoje: já não tem a atividade
  });
});

describe('GET /api/calendar', () => {
  test.each([
    ['', 'Informe start e end no formato AAAA-MM-DD'],
    ['?start=2026-11-16', 'Informe start e end no formato AAAA-MM-DD'],
    ['?start=2026-11-16&end=2026-02-30', 'Informe start e end no formato AAAA-MM-DD'],
    ['?start=2026-11-22&end=2026-11-16', 'A data final deve ser igual ou posterior à inicial'],
    ['?start=2026-01-01&end=2026-12-31', 'O período pode ter no máximo 93 dias'],
  ])('parâmetros inválidos %s → 400', async (query, message) => {
    const res = await asAna.get(`/api/calendar${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  test('status das atividades e dos dias; só dados do próprio usuário', async () => {
    const d1 = addDays(today(), -3);
    const d2 = addDays(today(), -2);
    const d3 = addDays(today(), -1);
    const activity = await createActivity(db.prisma, ana.id, { startDate: d1 });
    await createOccurrence(db.prisma, activity, d1, { status: 'concluida' });
    await createOccurrence(db.prisma, activity, d2, { status: 'falhou' });
    const other = await createActivity(db.prisma, bia.id, { startDate: d1, name: 'Da Bia' });
    await createOccurrence(db.prisma, other, d3, { status: 'falhou' });

    const res = await asAna.get(`/api/calendar?start=${d1}&end=${addDays(today(), 1)}`);
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(today());
    const byDate = Object.fromEntries(res.body.days.map((d) => [d.date, d]));

    expect(byDate[d1]).toMatchObject({ status: 'concluido', isPast: true });
    expect(byDate[d1].activities[0].status).toBe('concluida');
    expect(byDate[d2]).toMatchObject({ status: 'falhou' });
    expect(byDate[d2].activities[0].status).toBe('falhou');
    expect(byDate[today()]).toMatchObject({ status: 'pendente', isToday: true });
    expect(byDate[today()].weekday).toBe(weekdayOf(today()));

    const names = res.body.days.flatMap((d) => d.activities.map((a) => a.name));
    expect(names).not.toContain('Da Bia');
    expect(JSON.stringify(res.body)).not.toContain('token');
  });

  test('dia sem atividades → vazio', async () => {
    const res = await asAna.get(`/api/calendar?start=${today()}&end=${today()}`);
    expect(res.body.days).toEqual([
      expect.objectContaining({ date: today(), status: 'vazio', activities: [] }),
    ]);
  });
});
