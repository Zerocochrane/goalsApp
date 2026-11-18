// Validação pelo link do WhatsApp, sobre um SQLite temporário com as migrations reais.
import { test, describe, beforeAll as before, afterAll as after, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-validate-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;
process.env.WA_DISABLED = 'true';

const { prisma, disconnectDatabase } = await import('../src/db/prisma.js');
const { validateOccurrence, VALIDATION_MESSAGES } = await import('../src/occurrences/validate.js');

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations',
);

/** Instante em São Paulo (UTC-3) */
const sp = (iso) => new Date(`${iso}-03:00`);
const SCHEDULED = sp('2026-11-18T07:30:00');
const EXPIRES = sp('2026-11-18T08:30:00');

let ana, bia, occ;

before(async () => {
  for (const dir of fs.readdirSync(MIGRATIONS).sort()) {
    const file = path.join(MIGRATIONS, dir, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, 'utf8').replace(/^\s*--.*$/gm, '');
    for (const statement of sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
});

after(async () => {
  await disconnectDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.taskOccurrence.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.user.deleteMany();
  ana = await prisma.user.create({ data: { username: 'ana', passwordHash: 'x', name: 'Ana' } });
  bia = await prisma.user.create({ data: { username: 'bia', passwordHash: 'x', name: 'Bia' } });
  const activity = await prisma.activity.create({
    data: {
      userId: ana.id,
      name: 'Academia',
      hour: 7,
      minute: 30,
      weekdays: [3],
      startDate: '2026-11-18',
    },
  });
  occ = await prisma.taskOccurrence.create({
    data: {
      activityId: activity.id,
      userId: ana.id,
      date: '2026-11-18',
      scheduledAt: SCHEDULED,
      expiresAt: EXPIRES,
      token: 'tok-ana',
    },
  });
});

const validate = (userId, now, token = 'tok-ana') =>
  validateOccurrence({ prisma, token, userId, now });
const reload = () => prisma.taskOccurrence.findUnique({ where: { id: occ.id } });

describe('validação pelo link', () => {
  test('dentro de 1 hora: conclui', async () => {
    const now = sp('2026-11-18T07:45:00');
    const r = await validate(ana.id, now);
    assert.equal(r.code, 'concluida');
    assert.equal(r.httpStatus, 200);
    assert.equal(r.message, 'Atividade concluída! 🎉');
    assert.equal(r.occurrence.activityName, 'Academia');
    const row = await reload();
    assert.equal(row.status, 'concluida');
    assert.equal(row.completedAt.getTime(), now.getTime());
  });

  test('uma única vez: o segundo clique responde "já validada"', async () => {
    await validate(ana.id, sp('2026-11-18T07:45:00'));
    const r = await validate(ana.id, sp('2026-11-18T07:50:00'));
    assert.equal(r.code, 'ja_validado');
    assert.equal(r.httpStatus, 409);
    assert.equal(r.message, VALIDATION_MESSAGES.ja_validado);
    assert.equal((await reload()).completedAt.getTime(), sp('2026-11-18T07:45:00').getTime());
  });

  test('cliques simultâneos concluem só uma vez', async () => {
    const now = sp('2026-11-18T07:45:00');
    const results = await Promise.all([validate(ana.id, now), validate(ana.id, now)]);
    assert.deepEqual(results.map((r) => r.code).sort(), ['concluida', 'ja_validado']);
  });

  test('expirado sem o agendador ter rodado: não conclui e marca falhou', async () => {
    const r = await validate(ana.id, EXPIRES); // exatamente 1h depois já não vale
    assert.equal(r.code, 'expirado');
    assert.equal(r.httpStatus, 410);
    assert.equal(r.message, 'Este link expirou. A atividade foi marcada como não realizada.');
    const row = await reload();
    assert.equal(row.status, 'falhou');
    assert.equal(row.completedAt, null);
  });

  test('já marcada como falhou pelo agendador: expirado', async () => {
    await prisma.taskOccurrence.update({ where: { id: occ.id }, data: { status: 'falhou' } });
    const r = await validate(ana.id, sp('2026-11-18T09:00:00'));
    assert.equal(r.code, 'expirado');
    assert.equal((await reload()).status, 'falhou');
  });

  test('outro usuário: recusa sem alterar nada', async () => {
    const r = await validate(bia.id, sp('2026-11-18T07:45:00'));
    assert.equal(r.code, 'outro_usuario');
    assert.equal(r.httpStatus, 403);
    assert.equal(r.message, 'Este link não pertence à sua conta.');
    assert.equal(r.occurrence, null);
    assert.equal((await reload()).status, 'pendente');
  });

  test('token inexistente: inválido', async () => {
    const r = await validate(ana.id, sp('2026-11-18T07:45:00'), 'nao-existe');
    assert.equal(r.code, 'invalido');
    assert.equal(r.httpStatus, 404);
  });
});
