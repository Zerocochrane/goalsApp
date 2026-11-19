// Desktop e tablet (UX-07): calendário mais largo no desktop com nomes em até 2
// linhas, cabeçalho/abas alinhados ao conteúdo, 2 colunas de dias no tablet e
// espaço entre "Novo usuário" e a lista no celular.
import { test, expect } from '@playwright/test';
import { createUser, PASSWORD, prisma } from './helpers.js';
import { todayInSaoPaulo } from '../server/src/activities/recurrence.js';

const LONG_NAME = 'Treino funcional na academia do bairro 1'; // 40 caracteres

let user;

test.beforeAll(async () => {
  user = await createUser('layout');
  await prisma.activity.create({
    data: {
      userId: user.id,
      name: LONG_NAME,
      hour: 7,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: todayInSaoPaulo(),
    },
  });
});

async function login(page, username = user.username, password = PASSWORD) {
  const res = await page.request.post('/api/auth/login', { data: { username, password } });
  expect(res.ok()).toBe(true);
}

test('1280px: nome de 40 caracteres ocupa no máximo 2 linhas, com title', async ({ page }) => {
  expect(LONG_NAME).toHaveLength(40);
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.goto('/');
  const name = page.locator('.week-day[aria-current="date"] .week-activity-name').first();
  await expect(name).toHaveAttribute('title', LONG_NAME);
  const lines = await name.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return Math.round(el.getBoundingClientRect().height / lh);
  });
  expect(lines).toBeLessThanOrEqual(2);

  // Container mais largo que os 960px padrão
  const main = await page.locator('.app-main').boundingBox();
  expect(main.width).toBeGreaterThan(1100);
});

for (const path of ['/', '/perfil']) {
  test(`1280px: cabeçalho e abas alinhados ao conteúdo em ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto(path);
    const h1 = await page.locator('main h1').boundingBox();
    const brand = await page.locator('.app-brand').boundingBox();
    const firstTabText = await page
      .locator('.app-nav-link')
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('span'));
        return range.getBoundingClientRect().left;
      });
    expect(Math.abs(brand.x - h1.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(firstTabText - h1.x)).toBeLessThanOrEqual(1);
  });
}

test('768px: dias em grade de 2 colunas', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await login(page);
  await page.goto('/');
  await page.locator('.week-grid').waitFor();
  const columns = await page
    .locator('.week-grid')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
});

test('375px: "Novo usuário" não encosta na lista', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page, process.env.E2E_ADMIN_USER, process.env.E2E_ADMIN_PASSWORD);
  await page.goto('/usuarios');
  const button = await page.getByRole('button', { name: 'Novo usuário' }).boundingBox();
  const firstCard = await page.locator('.user-item').first().boundingBox();
  expect(firstCard.y - (button.y + button.height)).toBeGreaterThanOrEqual(12);
});
