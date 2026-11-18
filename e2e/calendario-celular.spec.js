// Calendário no celular (UX-02): abre no card de hoje, dias passados recolhidos,
// barra da semana fixa e semana na URL (?semana=AAAA-MM-DD).
import { test, expect } from '@playwright/test';
import { createUser, PASSWORD, prisma } from './helpers.js';
import { addDays, todayInSaoPaulo } from '../server/src/activities/recurrence.js';

const today = todayInSaoPaulo();
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
const monday = addDays(today, -((weekday + 6) % 7));
const nextMonday = addDays(monday, 7);

let user;

test.use({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });

test.beforeAll(async () => {
  // Várias atividades por dia desde segunda: cards altos, como no uso real
  user = await createUser('cal');
  for (const hour of [6, 9, 12, 15, 18]) {
    await prisma.activity.create({
      data: {
        userId: user.id,
        name: `Atividade das ${hour}h com um nome comprido para ocupar espaço`,
        hour,
        minute: 0,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startDate: monday,
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

/** Card de hoje inteiro abaixo do cabeçalho e da barra da semana fixos. */
async function expectTodayVisible(page) {
  const card = page.locator('.week-day[aria-current="date"]');
  await expect(card).toBeVisible();
  await expect
    .poll(async () => {
      const toolbar = await page.locator('.week-toolbar').boundingBox();
      const box = await card.boundingBox();
      return box.y >= toolbar.y + toolbar.height - 1 && box.y < 667;
    })
    .toBe(true);
}

test('abre com o card de hoje visível, sem rolar', async ({ page }) => {
  await page.goto('/');
  await page.locator('.week-grid').waitFor();
  await expectTodayVisible(page);
});

test('dias passados da semana atual ficam recolhidos e expandem ao tocar', async ({ page }) => {
  test.skip(weekday === 1, 'Segunda-feira: não há dia passado na semana');
  await page.goto('/');
  const firstDay = page.locator('.week-day').first();
  const toggle = firstDay.getByRole('button', { expanded: false });
  await expect(toggle).toBeVisible();
  await expect(firstDay.locator('.week-activities')).toBeHidden();
  await toggle.click();
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible();
  await expect(firstDay.locator('.week-activities')).toBeVisible();
});

test('navegar entre semanas não rola e fica na URL', async ({ page }) => {
  await page.goto('/');
  await page.locator('.week-grid').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole('button', { name: 'Próxima semana' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?semana=${nextMonday}$`));
  await expect(page.locator(`[data-add-date="${nextMonday}"]`)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // Outra semana: nenhum dia recolhido
  await expect(page.locator('.week-day-collapsed')).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.week-day[aria-current="date"]')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('link com ?semana= abre direto naquela semana', async ({ page }) => {
  await page.goto(`/?semana=${addDays(nextMonday, 2)}`);
  await expect(page.locator(`[data-add-date="${nextMonday}"]`)).toBeVisible();
  await expect(page.locator('.week-day[aria-current="date"]')).toHaveCount(0);
});

test('barra da semana fica fixa ao rolar', async ({ page }) => {
  await page.goto(`/?semana=${nextMonday}`);
  await page.locator('.week-grid').waitFor();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('button', { name: 'Próxima semana' })).toBeInViewport();
});
