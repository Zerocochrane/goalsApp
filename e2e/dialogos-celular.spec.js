// Diálogos no celular (UX-04): bottom sheet, ações empilhadas (Salvar em cima),
// "Excluir" afastado e rodapé de ações fixo — inclusive com o teclado aberto.
import { test, expect } from '@playwright/test';
import { createUser, PASSWORD, prisma, tomorrow } from './helpers.js';

let user;

test.use({ reducedMotion: 'reduce' });

test.beforeAll(async () => {
  user = await createUser('dlg');
  await prisma.activity.create({
    data: {
      userId: user.id,
      name: 'Atividade com um nome bem comprido para testar o diálogo',
      hour: 7,
      minute: 30,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: tomorrow(),
    },
  });
});

test.beforeEach(async ({ page }) => {
  const res = await page.request.post('/api/auth/login', {
    data: { username: user.username, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
});

async function openEdit(page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^Editar / })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Editar atividade' });
  await expect(dialog.getByLabel('Nome')).not.toHaveValue('');
  return dialog;
}

test.describe('celular 375px', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('editar vira bottom sheet com Salvar em cima, Cancelar e Excluir afastado', async ({
    page,
  }) => {
    const dialog = await openEdit(page);
    const box = await dialog.boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(375);
    expect(Math.round(box.y + box.height)).toBe(667);

    const save = await dialog.getByRole('button', { name: 'Salvar' }).boundingBox();
    const cancel = await dialog.getByRole('button', { name: 'Cancelar' }).boundingBox();
    const remove = dialog.getByRole('button', { name: 'Excluir' });
    await remove.scrollIntoViewIfNeeded();
    const removeBox = await remove.boundingBox();
    const cancelAfter = await dialog.getByRole('button', { name: 'Cancelar' }).boundingBox();

    // Empilhados em largura total, Salvar em cima
    expect(save.width).toBeGreaterThan(300);
    expect(cancel.width).toBe(save.width);
    expect(save.y).toBeLessThan(cancel.y);
    // Excluir abaixo, separado do Cancelar
    expect(removeBox.y - (cancelAfter.y + cancelAfter.height)).toBeGreaterThanOrEqual(24);
  });

  test('confirmação também é bottom sheet com a ação em cima', async ({ page }) => {
    const dialog = await openEdit(page);
    await dialog.getByRole('button', { name: 'Excluir' }).click();
    const confirm = page.getByRole('dialog', { name: /Excluir/ });
    await expect(confirm).toBeVisible();
    const box = await confirm.boundingBox();
    expect(box.width).toBe(375);
    expect(Math.round(box.y + box.height)).toBe(667);
    const cancel = await confirm.getByRole('button', { name: 'Cancelar' }).boundingBox();
    const others = confirm.getByRole('button').filter({ hasNotText: 'Cancelar' });
    expect((await others.boundingBox()).y).toBeLessThan(cancel.y);
  });
});

test('320×340 (teclado aberto): preenche e salva sem perder o botão', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 340 });
  const dialog = await openEdit(page);
  const save = dialog.getByRole('button', { name: 'Salvar' });

  await dialog.getByLabel('Nome').fill('Corrida');
  await expect(save).toBeInViewport({ ratio: 1 });
  await dialog.getByLabel('Horário').fill('06:15');
  await expect(save).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('checkbox', { name: 'Sábado' }).focus();
  await expect(save).toBeInViewport({ ratio: 1 });

  const box = await dialog.boundingBox();
  expect(box.height).toBeLessThanOrEqual(340 * 0.9 + 1);

  await save.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Corrida' })).toBeVisible();
});

test('desktop continua centralizado com Excluir à esquerda na mesma linha', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dialog = await openEdit(page);
  const box = await dialog.boundingBox();
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(2);
  const save = await dialog.getByRole('button', { name: 'Salvar' }).boundingBox();
  const remove = await dialog.getByRole('button', { name: 'Excluir' }).boundingBox();
  expect(Math.abs(save.y - remove.y)).toBeLessThan(2);
  expect(remove.x).toBeLessThan(save.x);
});
