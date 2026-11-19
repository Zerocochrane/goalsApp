// Link do WhatsApp no celular (UX-06): login amigável ao toque, "Manter conectado"
// e página de validação com resultado grande e botão em largura total.
import { test, expect } from '@playwright/test';
import {
  createUser,
  findOccurrence,
  loginWithForm,
  PASSWORD,
  prisma,
  runSchedulerAt,
  tomorrow,
  zonedDateTime,
} from './helpers.js';

// UA do navegador interno do WhatsApp no Android (WebView: "; wv)")
const WHATSAPP_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 WhatsApp/2.24';

test.describe('celular (toque)', () => {
  test.use({
    viewport: { width: 375, height: 667 },
    hasTouch: true,
    isMobile: true,
    userAgent: WHATSAPP_UA,
  });

  async function pendingOccurrence(prefix, name) {
    const user = await createUser(prefix);
    const date = tomorrow();
    await prisma.activity.create({
      data: {
        userId: user.id,
        name,
        hour: 8,
        minute: 0,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startDate: date,
      },
    });
    await runSchedulerAt(zonedDateTime(date, 8, 1));
    return { user, occurrence: await findOccurrence(user.id, date) };
  }

  test('login: sem autofocus, teclas do teclado, mostrar senha e dica do navegador', async ({
    page,
  }) => {
    await page.goto('/validar/qualquer');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

    const username = page.getByLabel('Usuário');
    const password = page.getByLabel('Senha', { exact: true });
    // No celular o teclado não abre sozinho
    await expect(username).not.toBeFocused();
    await expect(username).toHaveAttribute('enterkeyhint', 'next');
    await expect(password).toHaveAttribute('enterkeyhint', 'go');

    await password.fill('segredo');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await expect(page.getByRole('checkbox', { name: 'Manter conectado' })).toBeChecked();
    await expect(page.getByText('Precisa entrar toda vez?')).toBeVisible();

    // Nada transborda na largura do celular
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test('link → login → concluída, com cookie de 30 dias; depois, 1 toque basta', async ({
    page,
    context,
  }) => {
    const { user, occurrence } = await pendingOccurrence('wa', 'Caminhada');

    await page.goto(`/validar/${occurrence.token}`);
    await loginWithForm(page, user.username);
    await expect(page).toHaveURL(new RegExp(`/validar/${occurrence.token}$`));

    const card = page.locator('.validate-card');
    await expect(page.getByRole('heading', { name: 'Atividade concluída! 🎉' })).toBeVisible();
    await expect(card).toHaveAttribute('data-result', 'success');
    await expect(card.getByText('Caminhada')).toBeVisible();
    await expect(card.getByText(/às 08:00/)).toBeVisible();

    // Ícone grande e botão em largura total
    const icon = await card.locator('.validate-icon').boundingBox();
    expect(icon.width).toBeGreaterThanOrEqual(80);
    const button = page.getByRole('link', { name: 'Ir para o calendário' });
    const buttonBox = await button.boundingBox();
    const cardBox = await card.boundingBox();
    expect(buttonBox.width).toBeGreaterThan(cardBox.width * 0.8);
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);

    // "Manter conectado": cookie persistente de ~30 dias
    const cookie = (await context.cookies()).find((c) => c.name === 'goals_session');
    const days = (cookie.expires * 1000 - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);

    // Já logado, um segundo link conclui ao abrir — sem nenhum toque além do link
    const next = await pendingOccurrence('wa2', 'Alongamento');
    await prisma.taskOccurrence.update({
      where: { id: next.occurrence.id },
      data: { userId: user.id },
    });
    await page.goto(`/validar/${next.occurrence.token}`);
    await expect(page.getByRole('heading', { name: 'Atividade concluída! 🎉' })).toBeVisible();
    expect((await findOccurrence(user.id, next.occurrence.date)).status).toBe('concluida');
  });

  test('link inválido: ✕ vermelho', async ({ page }) => {
    const user = await createUser('wa3');
    const res = await page.request.post('/api/auth/login', {
      data: { username: user.username, password: PASSWORD },
    });
    expect(res.ok()).toBe(true);
    await page.goto('/validar/token-que-nao-existe');
    await expect(page.getByRole('heading', { name: 'Link de validação inválido.' })).toBeVisible();
    await expect(page.locator('.validate-card')).toHaveAttribute('data-result', 'error');
  });
});

test('desktop: foca o usuário, sem dica do WhatsApp; sem "Manter conectado" o cookie é de sessão', async ({
  page,
  context,
}) => {
  const user = await createUser('desk');
  await page.goto('/login');
  await expect(page.getByLabel('Usuário')).toBeFocused();
  await expect(page.getByText('Precisa entrar toda vez?')).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Manter conectado' }).uncheck();
  await loginWithForm(page, user.username);
  await expect(page).toHaveURL(/\/$/);
  const cookie = (await context.cookies()).find((c) => c.name === 'goals_session');
  expect(cookie.expires).toBe(-1);
});
