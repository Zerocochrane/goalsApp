// Fluxo completo: login → criar atividade → validar pelo link → dia verde,
// e o cenário de falha: link expira → atividade e dia vermelhos.
//
// A atividade é criada para AMANHÃ, e o agendador roda com relógio simulado no horário
// dela: assim o teste não depende da hora em que é executado.
import { test, expect } from '@playwright/test';
import {
  createUser,
  dayColumn,
  findOccurrence,
  loginWithForm,
  prisma,
  runSchedulerAt,
  themeColor,
  tomorrow,
  zonedDateTime,
} from './helpers.js';

test('login → criar atividade → validar pelo link → dia verde', async ({ page }) => {
  const user = await createUser('ana');
  const date = tomorrow();

  // Login (sem sessão, a raiz manda para /login)
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await loginWithForm(page, user.username);
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();

  // Criar a atividade clicando no dia
  let day = await dayColumn(page, date);
  await day.getByRole('button', { name: /^Nova atividade em/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova atividade' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nome').fill('Academia');
  await dialog.getByLabel('Horário').fill('08:00');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toBeHidden();

  day = await dayColumn(page, date);
  const activity = day.locator('.week-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).toContainText('08:00');
  await expect(activity).toContainText('Academia');
  await expect(activity).toHaveAttribute('data-status', 'pendente');

  // No horário, o agendador gera a ocorrência e "envia" o link
  await runSchedulerAt(zonedDateTime(date, 8, 1));
  const occurrence = await findOccurrence(user.id, date);
  expect(occurrence).toMatchObject({ status: 'pendente' });

  // Usuário abre o link recebido no WhatsApp
  await page.goto(`/validar/${occurrence.token}`);
  await expect(page.getByRole('heading', { name: 'Atividade concluída! 🎉' })).toBeVisible();
  await expect(page.getByText('Academia')).toBeVisible();
  expect((await findOccurrence(user.id, date)).status).toBe('concluida');

  // De volta ao calendário: atividade e dia verdes
  await page.getByRole('link', { name: 'Ir para o calendário' }).click();
  day = await dayColumn(page, date);
  await expect(day).toHaveAttribute('data-status', 'concluido');
  await expect(day.getByText('Dia concluído')).toBeVisible();
  await expect(day.locator('.week-activity')).toHaveAttribute('data-status', 'concluida');

  const success = await themeColor(page, '--color-success');
  await expect(day).toHaveCSS('border-top-color', success);
  await expect(day.locator('.week-activity')).toHaveCSS('border-left-color', success);
});

test('link expira → atividade e dia vermelhos', async ({ page }) => {
  const user = await createUser('bia');
  const date = tomorrow();
  await prisma.activity.create({
    data: {
      userId: user.id,
      name: 'Leitura',
      hour: 15,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: date,
    },
  });

  // Gera às 15:00 e, sem validação, o agendador marca `falhou` depois de 1 hora
  await runSchedulerAt(zonedDateTime(date, 15, 1));
  const { token } = await findOccurrence(user.id, date);
  await runSchedulerAt(zonedDateTime(date, 16, 1));
  expect((await findOccurrence(user.id, date)).status).toBe('falhou');

  // Clica no link depois do prazo, ainda sem sessão: login e volta para o link
  await page.goto(`/validar/${token}`);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await loginWithForm(page, user.username);
  await expect(page).toHaveURL(new RegExp(`/validar/${token}$`));
  await expect(
    page.getByRole('heading', {
      name: 'Este link expirou. A atividade foi marcada como não realizada.',
    }),
  ).toBeVisible();
  expect((await findOccurrence(user.id, date)).status).toBe('falhou');

  await page.getByRole('link', { name: 'Ir para o calendário' }).click();
  const day = await dayColumn(page, date);
  await expect(day).toHaveAttribute('data-status', 'falhou');
  await expect(day.getByText('Dia com falha')).toBeVisible();
  const activity = day.locator('.week-activity');
  await expect(activity).toHaveAttribute('data-status', 'falhou');
  await expect(activity).toContainText('Leitura');

  const danger = await themeColor(page, '--color-danger');
  await expect(day).toHaveCSS('border-top-color', danger);
  await expect(activity).toHaveCSS('border-left-color', danger);
});
