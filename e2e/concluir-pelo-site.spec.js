// Concluir a atividade pelo site (#32): botão "Disponível às HH:MM" → "Concluir atividade"
// (sem recarregar), atalho ✓ na linha, relógio do aparelho errado não burla a janela e
// layout de 320 a 1280px nos dois temas.
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { todayInSaoPaulo } from '../server/src/activities/recurrence.js';
import { createUser, loginWithForm, prisma } from './helpers.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const clock = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Atividade de hoje cuja ocorrência começa em `scheduledAt` (janela de 1 hora). */
async function todayActivity(user, name, scheduledAt) {
  const date = todayInSaoPaulo();
  const [hour, minute] = clock.format(scheduledAt).split(':').map(Number);
  const activity = await prisma.activity.create({
    data: {
      userId: user.id,
      name,
      hour,
      minute,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: date,
      createdAt: new Date(Date.now() - 2 * HOUR),
    },
  });
  const occurrence = await prisma.taskOccurrence.create({
    data: {
      activityId: activity.id,
      userId: user.id,
      date,
      scheduledAt,
      expiresAt: new Date(scheduledAt.getTime() + HOUR),
      token: crypto.randomBytes(32).toString('base64url'),
    },
  });
  return { activity, occurrence };
}

async function login(page, user) {
  await page.goto('/');
  await loginWithForm(page, user.username);
  await expect(page.getByRole('heading', { name: 'Início', level: 1 })).toBeVisible();
}

const todayCard = (page) => page.locator('li.week-day[aria-current="date"]');
const row = (page, name) => todayCard(page).locator('li.week-activity', { hasText: name });

test('modal: "Disponível às" desabilitado → habilita sozinho no horário → concluída', async ({
  page,
}) => {
  const user = await createUser('concluir-modal');
  const scheduledAt = new Date(Date.now() + 6000);
  await todayActivity(user, 'Academia', scheduledAt);
  await login(page, user);

  await row(page, 'Academia').getByRole('button', { name: /Editar Academia/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar atividade' });
  await expect(dialog.getByText('Status de hoje:')).toBeVisible();
  const waiting = dialog.getByRole('button', {
    name: `Disponível às ${clock.format(scheduledAt)}`,
  });
  await expect(waiting).toBeDisabled();
  // Antes do horário não há atalho ✓ na linha
  await expect(row(page, 'Academia').locator('.week-activity-complete')).toHaveCount(0);

  // Chega o horário: habilita sem recarregar, com a contagem do prazo
  const complete = dialog.getByRole('button', { name: 'Concluir atividade' });
  await expect(complete).toBeEnabled({ timeout: 15_000 });
  await expect(dialog.getByText(/faltam (59|60) min/)).toBeVisible();
  // A edição continua disponível
  await expect(dialog.getByRole('button', { name: 'Salvar' })).toBeEnabled();

  await complete.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Atividade concluída!' })).toBeVisible();
  await expect(row(page, 'Academia')).toHaveAttribute('data-status', 'concluida');
  // Única do dia: confete (#31)
  await expect(
    page.getByText('Parabéns! Você concluiu todas as atividades de hoje 🎉'),
  ).toBeVisible();

  const occ = await prisma.taskOccurrence.findFirst({ where: { userId: user.id } });
  expect(occ.status).toBe('concluida');

  // Reabrindo: status concluída e sem botão
  await row(page, 'Academia').getByRole('button', { name: /Editar Academia/ }).click();
  await expect(dialog.getByText('Concluída', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Concluir|Disponível/ })).toHaveCount(0);
});

test('atalho ✓ na linha conclui a atividade dentro do prazo', async ({ page }) => {
  const user = await createUser('concluir-atalho');
  await todayActivity(user, 'Leitura', new Date(Date.now() - 18 * MINUTE));
  await todayActivity(user, 'Academia', new Date(Date.now() + 2 * HOUR));
  await login(page, user);

  const shortcut = row(page, 'Leitura').getByRole('button', { name: /^Concluir Leitura/ });
  await expect(shortcut).toHaveAccessibleName(/faltam 4[12] min/);
  const box = await shortcut.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // A outra (mais tarde) ainda não tem atalho
  await expect(row(page, 'Academia').locator('.week-activity-complete')).toHaveCount(0);

  await shortcut.click();
  await expect(page.getByRole('status').filter({ hasText: 'Atividade concluída!' })).toBeVisible();
  await expect(row(page, 'Leitura')).toHaveAttribute('data-status', 'concluida');
  await expect(row(page, 'Leitura').locator('.week-activity-complete')).toHaveCount(0);
  // Não era a última do dia: sem confete
  await expect(page.locator('canvas.confetti-canvas')).toHaveCount(0);
});

test('relógio do aparelho adiantado não habilita antes do horário', async ({ page }) => {
  const user = await createUser('concluir-relogio');
  const scheduledAt = new Date(Date.now() + 30 * MINUTE);
  await todayActivity(user, 'Academia', scheduledAt);
  // Aparelho 40 minutos adiantado: pelo relógio dele, a janela já estaria aberta
  await page.clock.install({ time: new Date(Date.now() + 40 * MINUTE) });
  await login(page, user);

  await expect(row(page, 'Academia').locator('.week-activity-complete')).toHaveCount(0);
  await row(page, 'Academia').getByRole('button', { name: /Editar Academia/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar atividade' });
  await expect(
    dialog.getByRole('button', { name: `Disponível às ${clock.format(scheduledAt)}` }),
  ).toBeDisabled();

  // Mesmo chamando a API direto, o servidor recusa
  const activity = await prisma.activity.findFirst({ where: { userId: user.id } });
  const refused = await page.evaluate(async (id) => {
    const r = await fetch(`/api/activities/${id}/complete`, { method: 'POST' });
    return { status: r.status, body: await r.json() };
  }, activity.id);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe(
    `Esta atividade só pode ser concluída a partir das ${clock.format(scheduledAt)}.`,
  );
});

for (const theme of ['light', 'dark']) {
  for (const width of [320, 375, 768, 1280]) {
    test(`layout ${width}px (${theme}): atalho e modal cabem sem rolagem lateral`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      const user = await createUser(`concluir-${width}-${theme}`);
      await todayActivity(
        user,
        'Uma atividade com um nome bem comprido para testar quebra',
        new Date(Date.now() - 5 * MINUTE),
      );
      await login(page, user);

      const target = row(page, 'nome bem comprido');
      const shortcut = target.locator('.week-activity-complete');
      await expect(shortcut).toBeVisible();
      const box = await shortcut.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await target.getByRole('button', { name: /^Editar/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Editar atividade' });
      const complete = dialog.getByRole('button', { name: 'Concluir atividade' });
      await expect(complete).toBeVisible();
      await expect(complete).toBeFocused();
      const buttonBox = await complete.boundingBox();
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(width);
    });
  }
}
