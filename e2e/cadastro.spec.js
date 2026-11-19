// Cadastro pela própria pessoa (#30), no modo padrão (aprovação): criar a conta pelo
// celular, confirmar o WhatsApp com o código, o master aprova, a pessoa entra e cria
// uma atividade. Os modos "aberto" e "desligado" ficam nos testes de API
// (server/test/api/signup.test.js): o servidor do E2E sobe com um modo só.
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { dayColumn, loginWithForm, prisma, randomIp, setPhoneCode, tomorrow } from './helpers.js';
import { hashPassword } from '../server/src/auth/password.js';

const ADMIN = { username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASSWORD };
const SIGNUP_PASSWORD = 'minha-senha-123';
const CODE = '246810';

const newUsername = (prefix = 'novo') => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

// Contas criadas aqui não ficam para as outras suítes (o contador da aba "Usuários"
// mudaria as telas delas)
test.afterAll(async () => {
  await prisma.user.deleteMany({
    where: { createdBy: 'cadastro', username: { startsWith: 'novo-' } },
  });
});

// Cada teste sai de um IP próprio: o cadastro limita 1 código por minuto por IP
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': randomIp() });
});

/** Preenche e envia o formulário de /cadastro (a página já deve estar nele). */
async function fillSignup(page, { name, username, phone = '+55 (32) 98765-4321' }) {
  await page.getByLabel('Nome', { exact: true }).fill(name);
  await page.getByLabel('Nome de usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(SIGNUP_PASSWORD);
  await page.getByLabel('Confirme a senha').fill(SIGNUP_PASSWORD);
  await page.getByLabel('Telefone WhatsApp').fill(phone);
  await page.getByRole('button', { name: 'Criar conta' }).click();
}

test.describe('no celular', () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true });

  test('cria a conta, confirma o WhatsApp, master aprova, entra e cria atividade', async ({
    page,
  }) => {
    const username = newUsername();
    const name = `Pessoa ${username}`;

    // Login → "Criar conta"
    await page.goto('/login');
    await page.getByRole('link', { name: 'Criar conta' }).click();
    await expect(page).toHaveURL(/\/cadastro$/);
    await expect(page.getByRole('heading', { name: 'Criar conta' })).toBeVisible();

    // autocomplete certos (gerenciadores de senha e teclado do celular)
    await expect(page.getByLabel('Nome de usuário')).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    await expect(page.getByLabel('Confirme a senha')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    await expect(page.getByLabel('Telefone WhatsApp')).toHaveAttribute('autocomplete', 'tel');
    await expect(page.getByLabel('Telefone WhatsApp')).toHaveAttribute('type', 'tel');

    // Senhas diferentes: avisa sem chamar a API
    await page.getByLabel('Senha', { exact: true }).fill(SIGNUP_PASSWORD);
    await page.getByLabel('Confirme a senha').fill('outra-senha');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByText('As senhas não coincidem.')).toBeVisible();

    await fillSignup(page, { name, username });

    // Tela do código
    await expect(page.getByRole('heading', { name: 'Confirme seu WhatsApp' })).toBeVisible();
    await expect(page.getByText('+55 (32) 9****-4321')).toBeVisible();
    const code = page.getByLabel('Código de 6 dígitos');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toBeFocused();
    // Reenviar só depois da contagem regressiva
    const resend = page.getByRole('button', { name: /^Reenviar em 0:\d\d$/ });
    await expect(resend).toBeDisabled();

    const user = await prisma.user.findUnique({ where: { username } });
    expect(user).toMatchObject({ status: 'pendente', createdBy: 'cadastro', isMaster: false });

    // Código errado
    await code.fill('000000');
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Código inválido ou expirado. Restam 4 tentativas.')).toBeVisible();

    // Código certo (o WhatsApp está desligado: grava um código conhecido)
    await setPhoneCode(username, CODE);
    await code.fill(CODE);
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('heading', { name: 'Conta criada!' })).toBeVisible();
    await expect(page.getByText(/aguarda a aprovação do administrador/)).toBeVisible();

    // Ainda não entra
    await page.getByRole('link', { name: 'Voltar para o login' }).click();
    await loginWithForm(page, username, SIGNUP_PASSWORD);
    await expect(page.getByRole('alert')).toHaveText(
      'Sua conta aguarda aprovação do administrador.',
    );

    // Master: contador na aba, filtro "Pendentes", aprovar
    const res = await page.request.post('/api/auth/login', { data: ADMIN });
    expect(res.ok()).toBe(true);
    await page.goto('/usuarios');
    await expect(
      page.getByRole('link', { name: /Usuários/ }).locator('.app-nav-count'),
    ).toBeVisible();
    await page.getByRole('button', { name: /Pendentes/ }).click();
    const item = page.locator('.user-item', { hasText: `@${username}` });
    await expect(item.getByText('Aguardando aprovação')).toBeVisible();
    await item.getByRole('button', { name: `Aprovar o cadastro de ${name}` }).click();
    await expect(page.getByText(`Cadastro de ${name} aprovado.`)).toBeVisible();
    expect((await prisma.user.findUnique({ where: { username } })).status).toBe('ativo');

    // A pessoa entra e cria uma atividade
    await page.request.post('/api/auth/logout');
    await page.goto('/login');
    await loginWithForm(page, username, SIGNUP_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    const day = await dayColumn(page, tomorrow());
    await day.getByRole('button', { name: /^Nova atividade em/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova atividade' });
    await dialog.getByLabel('Nome').fill('Caminhada');
    await dialog.getByLabel('Horário').fill('07:00');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog).toBeHidden();
    await expect((await dayColumn(page, tomorrow())).locator('.week-activity')).toContainText(
      'Caminhada',
    );
  });

  test('fechou a tela do código: o login leva de volta para ela', async ({ page }) => {
    const username = newUsername();
    await page.goto('/cadastro');
    await fillSignup(page, { name: 'Volta Depois', username });
    await expect(page.getByRole('heading', { name: 'Confirme seu WhatsApp' })).toBeVisible();

    // Sai e volta pelo login (sem a sessionStorage)
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/login');
    await loginWithForm(page, username, SIGNUP_PASSWORD);
    await expect(page).toHaveURL(/\/cadastro$/);
    await expect(page.getByRole('heading', { name: 'Confirme seu WhatsApp' })).toBeVisible();

    await setPhoneCode(username, CODE);
    await page.getByLabel('Código de 6 dígitos').fill(CODE);
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('heading', { name: 'Conta criada!' })).toBeVisible();
  });

  test('nome de usuário em uso aparece no campo', async ({ page }) => {
    await page.goto('/cadastro');
    await fillSignup(page, { name: 'Outra Pessoa', username: ADMIN.username });
    await expect(page.getByText('Este nome de usuário já está em uso')).toBeVisible();
    await expect(page.getByLabel('Nome de usuário')).toHaveAttribute('aria-invalid', 'true');
  });
});

test('master recusa um cadastro pendente', async ({ page }) => {
  const username = newUsername('recusa');
  const name = `Recusa ${username}`;
  await prisma.user.create({
    data: {
      username,
      name,
      phone: '+5532911223344',
      phoneVerifiedAt: new Date(),
      status: 'pendente',
      createdBy: 'cadastro',
      passwordHash: await hashPassword(SIGNUP_PASSWORD),
    },
  });

  await page.request.post('/api/auth/login', { data: ADMIN });
  await page.goto('/usuarios');
  const item = page.locator('.user-item', { hasText: `@${username}` });
  await item.getByRole('button', { name: `Recusar o cadastro de ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Recusar cadastro?' });
  await dialog.getByRole('button', { name: 'Recusar' }).click();
  await expect(page.getByText(`Cadastro de ${name} recusado.`)).toBeVisible();
  await expect(item).toHaveCount(0);
  expect(await prisma.user.findUnique({ where: { username } })).toBeNull();
});

// Responsividade das telas do cadastro (320–1280px, claro e escuro)
const SCREENS = [
  { name: 'login', path: '/login', heading: 'Entrar' },
  { name: 'formulario', path: '/cadastro', heading: 'Criar conta' },
  {
    name: 'codigo',
    path: '/cadastro',
    heading: 'Confirme seu WhatsApp',
    // Ticket falso na sessionStorage: a tela do código abre sem cadastrar ninguém
    init: () =>
      sessionStorage.setItem(
        'goals:signup',
        JSON.stringify({
          ticket: 'ticket-de-teste',
          phone: '+55 (32) 9****-4321',
          resendIn: 60,
          savedAt: Date.now(),
        }),
      ),
  },
];

for (const scheme of ['light', 'dark']) {
  for (const width of [320, 375, 768, 1280]) {
    test.describe(`cadastro · ${scheme} · ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      for (const screen of SCREENS) {
        test(screen.name, async ({ page }, testInfo) => {
          if (screen.init) await page.addInitScript(screen.init);
          await page.goto(screen.path);
          await expect(page.getByRole('heading', { name: screen.heading })).toBeVisible();
          await page.waitForLoadState('networkidle');
          await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
          if (screen.name === 'login') {
            await expect(page.getByRole('link', { name: 'Criar conta' })).toBeVisible();
          }

          const report = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const outside = [...document.querySelectorAll('body *')]
              .filter((el) => !el.closest('.sr-only'))
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && (r.right > vw + 1 || r.left < -1);
              })
              .map((el) => el.tagName.toLowerCase());
            const small = [...document.querySelectorAll('a[href], button, input')]
              .filter((el) => !el.closest('.sr-only') && el.getClientRects().length > 0)
              .filter((el) => {
                const target = el.matches('label > input[type="checkbox"]') ? el.parentElement : el;
                const r = target.getBoundingClientRect();
                return r.width < 43.5 || r.height < 43.5;
              })
              .map((el) => (el.textContent || el.name || el.tagName).trim().slice(0, 30));
            return { scroll: document.documentElement.scrollWidth - vw, outside, small };
          });
          expect(report.scroll, 'rolagem horizontal').toBeLessThanOrEqual(0);
          expect(report.outside, 'elementos saindo da tela').toEqual([]);
          if (width <= 414) expect(report.small, 'controles menores que 44×44px').toEqual([]);

          await page.screenshot({
            path: testInfo.outputPath(`${screen.name}-${width}-${scheme}.png`),
            fullPage: true,
          });
        });
      }
    });
  }
}
