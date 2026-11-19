// Confete ao concluir todas as atividades do dia (#31): aparece uma vez, some sozinho,
// não bloqueia cliques e respeita o movimento reduzido.
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { todayInSaoPaulo } from '../server/src/activities/recurrence.js';
import { createUser, loginWithForm, prisma } from './helpers.js';

const NOTICE = 'Parabéns! Você concluiu todas as atividades de hoje 🎉';
const MINUTE = 60 * 1000;

/** Atividade de hoje com ocorrência no status dado (pendente = dentro da janela de 1h). */
async function todayActivity(user, name, status = 'pendente') {
  const date = todayInSaoPaulo();
  const activity = await prisma.activity.create({
    data: {
      userId: user.id,
      name,
      hour: 0,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: date,
    },
  });
  const now = Date.now();
  return prisma.taskOccurrence.create({
    data: {
      activityId: activity.id,
      userId: user.id,
      date,
      status,
      scheduledAt: new Date(now - 10 * MINUTE),
      expiresAt: new Date(now + 50 * MINUTE),
      completedAt: status === 'concluida' ? new Date(now - 5 * MINUTE) : null,
      token: crypto.randomBytes(32).toString('base64url'),
    },
  });
}

/** Usuário com uma atividade de hoje já concluída e outra pendente (a última). */
async function lastActivityOfTheDay(prefix) {
  const user = await createUser(prefix);
  await todayActivity(user, 'Leitura', 'concluida');
  const last = await todayActivity(user, 'Academia');
  return { user, last };
}

async function validateWithLogin(page, user, occurrence) {
  await page.goto(`/validar/${occurrence.token}`);
  await loginWithForm(page, user.username);
  await expect(page.getByRole('heading', { name: 'Atividade concluída! 🎉' })).toBeVisible();
}

const notice = (page) => page.getByRole('status').filter({ hasText: NOTICE });
const canvas = (page) => page.locator('canvas.confetti-canvas');

test('validar a última atividade do dia mostra o aviso e o confete, uma vez só', async ({
  page,
}) => {
  const { user, last } = await lastActivityOfTheDay('confete');
  await validateWithLogin(page, user, last);

  await expect(notice(page)).toBeVisible();
  await expect(canvas(page)).toHaveCount(1);
  // Não bloqueia cliques
  await expect(canvas(page)).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.day-celebration')).toHaveCSS('pointer-events', 'none');
  await page.getByRole('link', { name: 'Ir para o calendário' }).click();
  await expect(page).toHaveURL(/\/$/);

  // Some sozinho (~2,5s) e o aviso também
  await expect(canvas(page)).toHaveCount(0, { timeout: 5000 });
  await expect(notice(page)).toHaveCount(0, { timeout: 8000 });

  const saved = await prisma.user.findUnique({ where: { id: user.id } });
  expect(saved.lastDayCelebrated).toBe(todayInSaoPaulo());

  // Recarregar não mostra de novo
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Início', level: 1 })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(notice(page)).toHaveCount(0);
  await expect(canvas(page)).toHaveCount(0);
});

test('validar uma atividade que não é a última do dia não comemora', async ({ page }) => {
  const user = await createUser('confete-meio');
  const first = await todayActivity(user, 'Academia');
  await todayActivity(user, 'Leitura');
  await validateWithLogin(page, user, first);
  await page.waitForTimeout(1000);
  await expect(notice(page)).toHaveCount(0);
  await expect(canvas(page)).toHaveCount(0);
});

test('com movimento reduzido só aparece o aviso', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { user, last } = await lastActivityOfTheDay('confete-reduzido');
  await validateWithLogin(page, user, last);
  await expect(notice(page)).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
});

test('no calendário, a atualização automática comemora quando hoje vira concluído', async ({
  page,
}) => {
  const { user, last } = await lastActivityOfTheDay('confete-calendario');
  await page.goto('/');
  await loginWithForm(page, user.username);
  await expect(page.getByRole('heading', { name: 'Início', level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(notice(page)).toHaveCount(0);

  // Concluída em outro aparelho; ao voltar para a aba o app recarrega
  await prisma.taskOccurrence.update({
    where: { id: last.id },
    data: { status: 'concluida', completedAt: new Date() },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notice(page)).toBeVisible();
  await expect(canvas(page)).toHaveCount(1);
});

for (const width of [320, 375, 768, 1280]) {
  test(`${width}px: sem rolagem horizontal durante o confete`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const { user, last } = await lastActivityOfTheDay(`confete-${width}`);
    await validateWithLogin(page, user, last);
    await expect(canvas(page)).toHaveCount(1);
    await expect(notice(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    const box = await page.locator('.day-celebration-notice').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
}
