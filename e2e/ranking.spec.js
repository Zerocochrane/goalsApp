// Ranking entre amigos (issue #29): posição na semana, no mês e por sequência, pódio,
// "Você" destacado, quem não tem atividades no fim, estado vazio e privacidade.
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { addDays, todayInSaoPaulo } from '../server/src/activities/recurrence.js';
import { createUser, loginWithForm, prisma, zonedDateTime } from './helpers.js';

const pair = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function befriend(a, b, status = 'aceita') {
  return prisma.friendship.create({
    data: { requesterId: a.id, addresseeId: b.id, pairKey: pair(a.id, b.id), status },
  });
}

/** Atividade diária com os status dos últimos dias (o último é ontem). */
async function history(user, statuses, name) {
  const today = todayInSaoPaulo();
  const start = addDays(today, -statuses.length);
  const activity = await prisma.activity.create({
    data: {
      userId: user.id,
      name,
      hour: 23,
      minute: 59,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: start,
    },
  });
  await prisma.taskOccurrence.createMany({
    data: statuses.map((status, i) => {
      const date = addDays(start, i);
      const scheduledAt = zonedDateTime(date, 23, 59);
      return {
        activityId: activity.id,
        userId: user.id,
        date,
        scheduledAt,
        status,
        token: crypto.randomBytes(16).toString('hex'),
        expiresAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
      };
    }),
  });
}

test('ranking por sequência, pódio, "Você" e quem não tem atividades no fim', async ({ page }) => {
  const ana = await createUser('ana');
  const bia = await createUser('bia');
  const caio = await createUser('caio'); // amigo sem atividades
  const davi = await createUser('davi'); // só pedido pendente: fica de fora
  await befriend(ana, bia);
  await befriend(caio, ana);
  await befriend(davi, ana, 'pendente');
  await history(ana, ['concluida', 'falhou', 'concluida', 'concluida'], 'Atividade da Ana');
  await history(
    bia,
    ['concluida', 'concluida', 'concluida', 'concluida', 'concluida'],
    'Remédio secreto da Bia',
  );
  await history(davi, ['concluida'], 'Atividade do Davi');

  await page.goto('/amigos');
  await loginWithForm(page, ana.username);
  await page
    .getByRole('navigation', { name: 'Amigos e ranking' })
    .getByRole('link', { name: 'Ranking' })
    .click();
  await expect(page).toHaveURL(/\/amigos\/ranking$/);
  await expect(page.getByRole('heading', { name: 'Ranking', exact: true })).toBeVisible();

  // Esta semana (padrão): mostra o período
  await expect(page.getByRole('button', { name: 'Esta semana' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('ranking-range')).toContainText(/\d+ (a|de)/);

  // Sequência atual
  await page.getByRole('button', { name: 'Sequência atual' }).click();
  const list = page.getByRole('list', { name: /Ranking — Sequência atual/ });
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(bia.name);
  await expect(rows.nth(0)).toContainText('1º lugar');
  await expect(rows.nth(0)).toContainText('🥇');
  await expect(rows.nth(0)).toContainText('5 dias seguidos');
  await expect(rows.nth(1)).toContainText(ana.name);
  await expect(rows.nth(1)).toContainText('Você');
  await expect(rows.nth(1)).toContainText('🥈');
  await expect(rows.nth(1)).toContainText('Recorde: 2 dias');
  await expect(rows.nth(1)).toHaveClass(/ranking-row-you/);
  await expect(rows.nth(2)).toContainText(caio.name);
  await expect(rows.nth(2)).toContainText('Sem atividades');
  await expect(rows.nth(2)).not.toContainText('lugar');

  // Mês: barra de progresso com o percentual
  await page.getByRole('button', { name: 'Este mês' }).click();
  await expect(page.getByRole('list', { name: /Ranking — Este mês/ })).toBeVisible();
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', /\d+/);

  // Privacidade: nada de nomes de atividades nem de quem não é amigo aceito
  const text = await page.locator('main').innerText();
  expect(text).not.toContain('Remédio secreto');
  expect(text).not.toContain('Atividade da');
  expect(text).not.toContain(davi.name);
});

test('estado vazio leva para a página de amigos', async ({ page }) => {
  const solo = await createUser('solo');
  await page.goto('/amigos/ranking');
  await loginWithForm(page, solo.username);
  await expect(page.getByText('Adicione amigos para ver o ranking.')).toBeVisible();
  await page.getByRole('link', { name: 'Adicionar amigos' }).click();
  await expect(page).toHaveURL(/\/amigos$/);
  await expect(page.getByRole('heading', { name: 'Amigos', exact: true })).toBeVisible();
});

test('atualiza ao voltar para a aba', async ({ page }) => {
  const eva = await createUser('eva');
  const fabi = await createUser('fabi');
  await page.goto('/amigos/ranking');
  await loginWithForm(page, eva.username);
  await expect(page.getByText('Adicione amigos para ver o ranking.')).toBeVisible();

  await befriend(eva, fabi);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('list', { name: /Ranking/ }).getByText(fabi.name)).toBeVisible();
});
