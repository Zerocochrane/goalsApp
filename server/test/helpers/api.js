// Utilitários dos testes de API (Supertest sobre o app Express real).
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/password.js';
import { addDays, todayInSaoPaulo, zonedDateTime } from '../../src/activities/recurrence.js';

export const PASSWORD = 'senha-secreta';

/**
 * App sem o build do React (só a API). `send` substitui o WhatsApp (padrão: descarta).
 */
export function buildApp({ send = async () => {} } = {}) {
  return createApp({ clientDist: '/caminho/que/nao/existe', send });
}

/** Envio falso do WhatsApp que guarda as mensagens (para ler o código enviado). */
export function fakeWhatsApp() {
  const sent = [];
  return {
    sent,
    send: async (phone, text) => {
      sent.push({ phone, text });
    },
    /** Último código de 6 dígitos enviado para `phone`. */
    lastCode(phone) {
      const message = sent.findLast((m) => m.phone === phone && /código/.test(m.text));
      return message?.text.match(/\*(\d{6})\*/)?.[1];
    },
  };
}

/** Agente Supertest anônimo com um IP próprio (rate limits por IP não se misturam). */
export function anonymousAgent(app) {
  return request
    .agent(app)
    .set('X-Forwarded-For', `10.2.${++anonCounter >> 8}.${anonCounter & 255}`);
}

let ipCounter = 0;
let anonCounter = 0;

// Mesmo hash para todos os usuários de teste (bcrypt com 12 rounds é lento)
let passwordHash;
export async function createUser(prisma, { username, isMaster = false, ...data } = {}) {
  passwordHash ??= await hashPassword(PASSWORD);
  return prisma.user.create({
    data: { username, name: username, passwordHash, isMaster, ...data },
  });
}

/**
 * Agente Supertest já logado (guarda o cookie). Cada agente usa um IP próprio
 * (X-Forwarded-For, aceito do loopback) para não disputar o rate limit do login.
 */
export async function loginAs(app, username, password = PASSWORD) {
  const ip = `10.1.0.${++ipCounter}`;
  const agent = request.agent(app).set('X-Forwarded-For', ip);
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login de ${username} falhou: ${res.status}`);
  return agent;
}

export const today = () => todayInSaoPaulo();
export { addDays };

/** Cria uma ocorrência direto no banco (o que o agendador faria). */
export function createOccurrence(prisma, activity, date, overrides = {}) {
  const scheduledAt = zonedDateTime(date, activity.hour, activity.minute);
  return prisma.taskOccurrence.create({
    data: {
      activityId: activity.id,
      userId: activity.userId,
      date,
      scheduledAt,
      expiresAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
      token: crypto.randomBytes(32).toString('base64url'),
      ...overrides,
    },
  });
}

/** Cria uma atividade direto no banco (permite datas passadas). */
export function createActivity(prisma, userId, overrides = {}) {
  return prisma.activity.create({
    data: {
      userId,
      name: 'Academia',
      hour: 7,
      minute: 30,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: today(),
      ...overrides,
    },
  });
}

/** Valor do cookie de sessão e seus atributos, a partir do Set-Cookie. */
export function sessionCookie(res) {
  const header = [res.headers['set-cookie'] ?? []]
    .flat()
    .find((c) => c.startsWith('goals_session='));
  if (!header) return null;
  const [pair, ...attrs] = header.split(';').map((s) => s.trim());
  return {
    value: pair.slice('goals_session='.length),
    attrs: attrs.map((a) => a.toLowerCase()),
    raw: header,
  };
}
