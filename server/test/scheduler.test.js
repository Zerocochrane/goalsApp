// Agendador com relógio simulado, sobre um SQLite temporário com as migrations reais.
import { test, describe, beforeAll as before, afterAll as after, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-scheduler-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;
process.env.WA_DISABLED = 'true';

// Importa depois de definir DATABASE_URL (o cliente Prisma lê na importação)
const { prisma, disconnectDatabase } = await import('../src/db/prisma.js');
const { createScheduler, buildMessage, validationLink, VALIDATION_WINDOW_MS, RETRY_INTERVAL_MS } =
  await import('../src/scheduler/scheduler.js');

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations',
);
const APP_URL = 'https://goals.example.com/';
const MON = 1,
  WED = 3,
  FRI = 5;

/** Instante em São Paulo (UTC-3) */
const sp = (iso) => new Date(`${iso}-03:00`);

/** Relógio simulado + envio falso */
function harness({ failSend = false } = {}) {
  const clock = { now: sp('2026-11-18T00:00:00') };
  const sent = [];
  const ctl = { failSend };
  const scheduler = createScheduler({
    prisma,
    appUrl: APP_URL,
    now: () => new Date(clock.now),
    log: () => {},
    send: async (phone, text) => {
      if (ctl.failSend) throw new Error('WhatsApp não está conectado');
      sent.push({ phone, text });
    },
  });
  // `when`: 'AAAA-MM-DDThh:mm:ss' em São Paulo ou um Date
  const at = async (when, options) => {
    clock.now = when instanceof Date ? when : sp(when);
    const result = await scheduler.tick(options);
    await result.deliveries;
    return result;
  };
  const recoverAt = async (iso) => {
    clock.now = sp(iso);
    const result = await scheduler.recover();
    await result.deliveries;
    return result;
  };
  return { scheduler, sent, ctl, at, recoverAt };
}

let user;

async function createActivity(overrides = {}) {
  const createdAt = overrides.createdAt ?? sp('2026-11-17T12:00:00');
  return prisma.activity.create({
    data: {
      userId: user.id,
      name: 'Academia',
      hour: 7,
      minute: 30,
      weekdays: [MON, WED, FRI],
      startDate: '2026-11-16',
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    },
  });
}

const occurrences = () =>
  prisma.taskOccurrence.findMany({ orderBy: [{ date: 'asc' }, { id: 'asc' }] });

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
  user = await prisma.user.create({
    data: { username: 'ana', passwordHash: 'x', name: 'Ana', phone: '+5532999999999' },
  });
});

describe('mensagem', () => {
  test('texto e link de validação', () => {
    assert.equal(
      validationLink('https://goals.example.com/', 'abc'),
      'https://goals.example.com/validar/abc',
    );
    assert.equal(
      buildMessage('Academia', 'https://x/validar/abc'),
      '*Academia* deve ser feita agora! Depois de concluir, clique neste link para validar a atividade. https://x/validar/abc',
    );
  });
});

describe('envio', () => {
  test('nada antes do horário', async () => {
    await createActivity();
    const { sent, at } = harness();
    await at('2026-11-18T07:29:00');
    assert.equal((await occurrences()).length, 0);
    assert.equal(sent.length, 0);
  });

  test('no horário: cria a ocorrência pendente, envia o link e registra notifiedAt', async () => {
    const activity = await createActivity();
    const { sent, at } = harness();
    await at('2026-11-18T07:30:00');

    const [occ] = await occurrences();
    assert.equal(occ.activityId, activity.id);
    assert.equal(occ.userId, user.id);
    assert.equal(occ.date, '2026-11-18');
    assert.equal(occ.status, 'pendente');
    assert.equal(occ.scheduledAt.getTime(), sp('2026-11-18T07:30:00').getTime());
    assert.equal(occ.expiresAt.getTime(), occ.scheduledAt.getTime() + VALIDATION_WINDOW_MS);
    assert.match(occ.token, /^[A-Za-z0-9_-]{43}$/); // 32 bytes em base64url
    assert.equal(occ.notifiedAt.getTime(), sp('2026-11-18T07:30:00').getTime());

    assert.deepEqual(sent, [
      {
        phone: '+5532999999999',
        text: `*Academia* deve ser feita agora! Depois de concluir, clique neste link para validar a atividade. https://goals.example.com/validar/${occ.token}`,
      },
    ]);
  });

  test('execuções seguintes não duplicam nem reenviam', async () => {
    await createActivity();
    const { sent, at } = harness();
    await at('2026-11-18T07:30:00');
    await at('2026-11-18T07:31:00');
    await at('2026-11-18T07:45:00');
    assert.equal((await occurrences()).length, 1);
    assert.equal(sent.length, 1);
  });

  test('minuto perdido (cron atrasado) ainda gera e envia dentro da janela', async () => {
    await createActivity();
    const { sent, at } = harness();
    await at('2026-11-18T07:29:00');
    await at('2026-11-18T07:33:00');
    const [occ] = await occurrences();
    assert.equal(occ.status, 'pendente');
    assert.equal(sent.length, 1);
  });

  test('não gera em dia da semana fora da recorrência', async () => {
    await createActivity({ weekdays: [MON] });
    const { at } = harness();
    await at('2026-11-18T07:30:00'); // quarta
    assert.equal((await occurrences()).length, 0);
  });

  test('atividade criada depois do horário não gera ocorrência naquele dia', async () => {
    await createActivity({ startDate: '2026-11-18', createdAt: sp('2026-11-18T10:00:00') });
    const { at } = harness();
    await at('2026-11-18T10:01:00');
    assert.equal((await occurrences()).length, 0);
  });

  test('usuário sem telefone: ocorrência criada, sem envio', async () => {
    await prisma.user.update({ where: { id: user.id }, data: { phone: null } });
    await createActivity();
    const { sent, at } = harness();
    await at('2026-11-18T07:30:00');
    const [occ] = await occurrences();
    assert.equal(occ.status, 'pendente');
    assert.equal(occ.notifiedAt, null);
    assert.equal(sent.length, 0);
  });

  test('falha no WhatsApp: tenta de novo depois do intervalo, dentro da janela', async () => {
    await createActivity();
    const { sent, ctl, at } = harness({ failSend: true });
    await at('2026-11-18T07:30:00');
    assert.equal((await occurrences())[0].notifiedAt, null);

    ctl.failSend = false;
    await at('2026-11-18T07:31:00'); // antes do intervalo de nova tentativa
    assert.equal(sent.length, 0);

    const retry = new Date(sp('2026-11-18T07:30:00').getTime() + RETRY_INTERVAL_MS);
    await at(retry);
    assert.equal(sent.length, 1);
    assert.notEqual((await occurrences())[0].notifiedAt, null);
  });
});

describe('expiração', () => {
  test('pendente vira falhou quando passa 1 hora sem validar', async () => {
    await createActivity();
    const { at } = harness();
    await at('2026-11-18T07:30:00');
    await at('2026-11-18T08:29:00');
    assert.equal((await occurrences())[0].status, 'pendente');
    await at('2026-11-18T08:30:00');
    assert.equal((await occurrences())[0].status, 'falhou');
  });

  test('concluída não é alterada', async () => {
    await createActivity();
    const { at } = harness();
    await at('2026-11-18T07:30:00');
    const [occ] = await occurrences();
    await prisma.taskOccurrence.update({
      where: { id: occ.id },
      data: { status: 'concluida', completedAt: sp('2026-11-18T07:50:00') },
    });
    await at('2026-11-18T09:00:00');
    assert.equal((await occurrences())[0].status, 'concluida');
  });

  test('não reenvia ocorrência que já expirou', async () => {
    await createActivity();
    const { sent, ctl, at } = harness({ failSend: true });
    await at('2026-11-18T07:30:00');
    ctl.failSend = false;
    await at('2026-11-18T08:31:00');
    assert.equal(sent.length, 0);
    assert.equal((await occurrences())[0].status, 'falhou');
  });
});

describe('recuperação após reinício', () => {
  test('o que venceu com o servidor fora nasce falhou; o que está na janela é enviado', async () => {
    // Criada no domingo; servidor fora de segunda até quarta 08:00
    await createActivity({ createdAt: sp('2026-11-15T12:00:00') });
    const { sent, recoverAt } = harness();
    await recoverAt('2026-11-18T08:00:00');

    const occs = await occurrences();
    assert.deepEqual(
      occs.map((o) => [o.date, o.status]),
      [
        ['2026-11-16', 'falhou'], // segunda: perdida
        ['2026-11-18', 'pendente'], // quarta 07:30: ainda dentro de 1h
      ],
    );
    assert.equal(occs[0].notifiedAt, null);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, new RegExp(`/validar/${occs[1].token}$`));
  });

  test('servidor volta depois da janela: falhou, sem envio', async () => {
    await createActivity();
    const { sent, recoverAt } = harness();
    await recoverAt('2026-11-18T09:00:00');
    const occs = await occurrences();
    assert.deepEqual(
      occs.map((o) => [o.date, o.status]),
      [['2026-11-18', 'falhou']],
    );
    assert.equal(sent.length, 0);
  });

  test('pendente que venceu com o servidor fora vira falhou', async () => {
    await createActivity();
    const first = harness();
    await first.at('2026-11-18T07:30:00');
    const second = harness(); // "reinício"
    await second.recoverAt('2026-11-18T12:00:00');
    const occs = await occurrences();
    assert.equal(occs.length, 1);
    assert.equal(occs[0].status, 'falhou');
    assert.equal(second.sent.length, 0);
  });

  test('versão encerrada (atividade editada) gera só até o endDate', async () => {
    await createActivity({
      active: false,
      endDate: '2026-11-16',
      updatedAt: sp('2026-11-17T09:00:00'),
      createdAt: sp('2026-11-15T12:00:00'),
    });
    const { recoverAt } = harness();
    await recoverAt('2026-11-20T12:00:00');
    const occs = await occurrences();
    assert.deepEqual(
      occs.map((o) => o.date),
      ['2026-11-16'],
    );
  });
});

describe('idempotência', () => {
  test('dois agendadores ao mesmo tempo geram uma única ocorrência', async () => {
    await createActivity();
    const a = harness();
    const b = harness();
    await Promise.all([a.at('2026-11-18T07:30:00'), b.at('2026-11-18T07:30:00')]);
    assert.equal((await occurrences()).length, 1);
  });

  test('o índice único (activityId, date) recusa duplicata', async () => {
    const activity = await createActivity();
    const data = {
      activityId: activity.id,
      userId: user.id,
      date: '2026-11-18',
      scheduledAt: sp('2026-11-18T07:30:00'),
      expiresAt: sp('2026-11-18T08:30:00'),
    };
    await prisma.taskOccurrence.create({ data: { ...data, token: 'a' } });
    await assert.rejects(prisma.taskOccurrence.create({ data: { ...data, token: 'b' } }), {
      code: 'P2002',
    });
  });
});
