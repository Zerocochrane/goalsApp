// Acesso direto ao banco do app em teste e ao agendador com relógio simulado.
import crypto from 'node:crypto';
import { expect } from '@playwright/test';
import { prisma } from '../server/src/db/prisma.js';
import { hashPassword } from '../server/src/auth/password.js';
import { createScheduler } from '../server/src/scheduler/scheduler.js';
import { hashCode } from '../server/src/signup/verification.js';
import { addDays, todayInSaoPaulo, zonedDateTime } from '../server/src/activities/recurrence.js';

export { prisma, zonedDateTime };

export const PASSWORD = 'senha-e2e-123';

export const tomorrow = () => addDays(todayInSaoPaulo(), 1);

/** Usuário comum novo (nome único), com senha PASSWORD. */
export async function createUser(prefix = 'e2e') {
  const username = `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
  return prisma.user.create({
    data: { username, name: `Teste ${username}`, passwordHash: await hashPassword(PASSWORD) },
  });
}

/**
 * Roda uma execução do agendador como se agora fosse `at` (gera as ocorrências,
 * marca `falhou` as vencidas). O envio pelo WhatsApp é simulado.
 */
export async function runSchedulerAt(at) {
  const scheduler = createScheduler({
    prisma,
    now: () => new Date(at),
    send: async () => {},
    log: () => {},
  });
  const result = await scheduler.tick();
  await result.deliveries;
}

export function findOccurrence(userId, date) {
  return prisma.taskOccurrence.findFirst({ where: { userId, date } });
}

/** Faz login pela tela de login (a página já deve estar nela). */
export async function loginWithForm(page, username, password = PASSWORD) {
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/**
 * Coluna do dia `date` no calendário da semana (avança para a próxima semana se
 * preciso — ex.: hoje é domingo e `date` é amanhã).
 */
export async function dayColumn(page, date) {
  await expect(page.getByRole('list', { name: 'Dias da semana' })).toBeVisible();
  const add = page.locator(`[data-add-date="${date}"]`);
  if ((await add.count()) === 0) {
    await page.getByRole('button', { name: 'Próxima semana' }).click();
  }
  await expect(add).toBeVisible();
  return page.locator('li.week-day').filter({ has: add });
}

/** Valor computado de uma variável de cor do tema, no formato do getComputedStyle. */
export function themeColor(page, cssVar) {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, cssVar);
}

/**
 * Troca o código de confirmação do telefone de `username` por `code` (o WhatsApp está
 * desligado nos testes, então o código de verdade não chega a lugar nenhum).
 */
export async function setPhoneCode(username, code) {
  const user = await prisma.user.findUnique({ where: { username } });
  await prisma.phoneVerification.update({
    where: { userId: user.id },
    data: { codeHash: hashCode(user.id, code) },
  });
}

/** IP falso por teste (o cadastro limita 1 código por minuto por IP). */
export function randomIp() {
  const b = crypto.randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}
