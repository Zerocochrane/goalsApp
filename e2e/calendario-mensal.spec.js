// Visão mensal do calendário (#27): alternância Semana | Mês, mês na URL
// (?mes=AAAA-MM), status de cada dia (cor + ícone + contagem) e detalhe do dia
// com criação de atividade (dias passados só leitura).
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createUser, PASSWORD, prisma, tomorrow, zonedDateTime } from './helpers.js';
import { addDays, todayInSaoPaulo } from '../server/src/activities/recurrence.js';

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const today = todayInSaoPaulo();
const currentMonth = today.slice(0, 7);

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthTitle(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}

// Mês passado inteiro: dias 1–4 sem atividade, dia 5 concluído, dia 6 com falha,
// demais pendentes (sem ocorrência)
const pastMonth = shiftMonth(currentMonth, -1);
const doneDay = `${pastMonth}-05`;
const failedDay = `${pastMonth}-06`;
const emptyDay = `${pastMonth}-02`;

let user;

test.beforeAll(async () => {
  user = await createUser('mes');
  const activity = await prisma.activity.create({
    data: {
      userId: user.id,
      name: 'Leitura',
      hour: 7,
      minute: 30,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: doneDay,
    },
  });
  for (const [date, status] of [
    [doneDay, 'concluida'],
    [failedDay, 'falhou'],
  ]) {
    const scheduledAt = zonedDateTime(date, 7, 30);
    await prisma.taskOccurrence.create({
      data: {
        activityId: activity.id,
        userId: user.id,
        date,
        scheduledAt,
        status,
        token: crypto.randomBytes(16).toString('hex'),
        expiresAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
        completedAt: status === 'concluida' ? scheduledAt : null,
      },
    });
  }
});

test.beforeEach(async ({ page }) => {
  const res = await page.request.post('/api/auth/login', {
    data: { username: user.username, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
});

const dayCell = (page, date) => page.locator(`.month-day[data-date="${date}"]`);

test('a semana continua sendo a visão padrão e alterna para o mês', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: 'Visualização do calendário' });
  await expect(group.getByRole('button', { name: 'Semana' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('list', { name: 'Dias da semana' })).toBeVisible();

  await group.getByRole('button', { name: 'Mês' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?mes=${currentMonth}$`));
  await expect(group.getByRole('button', { name: 'Mês' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(monthTitle(currentMonth));
  await expect(dayCell(page, today)).toHaveAttribute('aria-current', 'date');

  await group.getByRole('button', { name: 'Semana' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('list', { name: 'Dias da semana' })).toBeVisible();
});

test('navega entre meses com a URL e o botão Hoje', async ({ page }) => {
  await page.goto(`/?mes=${currentMonth}`);
  const grid = page.getByRole('list', { name: 'Dias do mês' });
  await expect(grid).toBeVisible();
  // Semanas de segunda a domingo: 4 a 6 linhas completas
  const count = await grid.locator('.month-day').count();
  expect([28, 35, 42]).toContain(count);
  const first = await grid.locator('.month-day').first().getAttribute('data-date');
  expect(new Date(`${first}T12:00:00Z`).getUTCDay()).toBe(1);

  const next = shiftMonth(currentMonth, 1);
  await page.getByRole('button', { name: 'Próximo mês' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?mes=${next}$`));
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(monthTitle(next));
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?mes=${pastMonth}$`));
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(monthTitle(pastMonth));

  await page.getByRole('button', { name: 'Hoje' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?mes=${currentMonth}$`));
  await expect(dayCell(page, today)).toHaveAttribute('aria-pressed', 'true');

  // Voltar do navegador restaura o mês anterior
  await page.goBack();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(monthTitle(pastMonth));
});

test('cores e ícones de cada dia seguem o status', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/?mes=${pastMonth}`);

  const done = dayCell(page, doneDay);
  await expect(done).toHaveAttribute('data-status', 'concluido');
  await expect(done.locator('.month-day-icon')).toHaveText('✓');
  await expect(done.locator('.month-day-count')).toHaveText('1/1');
  await expect(done).toHaveAccessibleName(/Dia concluído, 1 de 1 atividade concluída/);

  const failed = dayCell(page, failedDay);
  await expect(failed).toHaveAttribute('data-status', 'falhou');
  await expect(failed.locator('.month-day-icon')).toHaveText('✕');
  await expect(failed.locator('.month-day-count')).toHaveText('0/1');
  await expect(failed).toHaveAccessibleName(/Dia com falha/);

  // Sem atividades: neutro, sem ícone nem contagem
  const empty = dayCell(page, emptyDay);
  await expect(empty).toHaveAttribute('data-status', 'vazio');
  await expect(empty.locator('.month-day-icon')).toHaveCount(0);
  await expect(empty).toHaveAccessibleName(/nenhuma atividade/);

  // Cores do tema: verde no concluído, vermelho na falha (mais o ícone)
  const colors = await page.evaluate(
    ([a, b, c]) =>
      [a, b, c].map(
        (date) =>
          getComputedStyle(document.querySelector(`.month-day[data-date="${date}"]`))
            .backgroundColor,
      ),
    [doneDay, failedDay, emptyDay],
  );
  expect(new Set(colors).size).toBe(3);

  // Dia do mês seguinte na grade: esmaecido
  const outside = page.locator('.month-day-outside').first();
  if ((await outside.count()) > 0) {
    expect(Number(await outside.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
  }
});

test('dia passado abre o detalhe só para leitura', async ({ page }) => {
  await page.goto(`/?mes=${pastMonth}`);
  await dayCell(page, doneDay).click();
  await expect(dayCell(page, doneDay)).toHaveAttribute('aria-pressed', 'true');

  const detail = page.locator('.month-detail');
  await expect(detail).toContainText('Dia passado: só leitura.');
  await expect(detail).toContainText('Leitura');
  await expect(detail.getByText('Dia concluído')).toBeVisible();
  await expect(detail.getByRole('button')).toHaveCount(0);
});

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['celular', { width: 375, height: 667 }],
]) {
  test(`abre um dia futuro e cria atividade (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const date = tomorrow();
    await page.goto(`/?mes=${date.slice(0, 7)}`);
    await dayCell(page, date).click();

    const detail = page.locator('.month-detail');
    await expect(detail).toBeInViewport();
    await detail.locator(`[data-add-date="${date}"]`).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Nova atividade' })).toBeVisible();
    const name = `Natação ${label}`;
    await dialog.getByLabel('Nome').fill(name);
    await dialog.getByLabel('Horário').fill('19:15');
    await dialog.getByRole('button', { name: 'Salvar' }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: `Atividade ${name} criada.` }),
    ).toBeVisible();
    await expect(detail.getByRole('button', { name: new RegExp(`Editar ${name}`) })).toBeVisible();
    await expect(dayCell(page, date)).toHaveAccessibleName(/atividades? concluídas?/);
    // Foco volta ao botão que abriu o modal
    await expect(detail.locator(`[data-add-date="${date}"]`)).toBeFocused();
  });
}

test('voltar para Semana mostra a semana atual', async ({ page }) => {
  await page.goto(`/?mes=${currentMonth}`);
  await page
    .getByRole('group', { name: 'Visualização do calendário' })
    .getByRole('button', { name: 'Semana' })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(`[data-add-date="${addDays(today, 0)}"]`)).toBeVisible();
});
