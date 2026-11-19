// Revisão de todas as telas: textos em pt-BR, modo claro/escuro e responsividade
// (sem rolagem horizontal do celular ao desktop).
import { test, expect } from '@playwright/test';
import { createUser, prisma, tomorrow } from './helpers.js';

const ADMIN = { username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASSWORD };

const SCREENS = [
  { name: 'login', path: '/login', heading: 'Entrar', public: true },
  { name: 'cadastro', path: '/cadastro', heading: 'Criar conta', public: true },
  { name: 'inicio', path: '/', heading: 'Início' },
  { name: 'nova-atividade', path: '/', heading: 'Nova atividade', open: openActivityDialog },
  { name: 'amigos', path: '/amigos', heading: 'Amigos', exact: true },
  { name: 'ranking', path: '/amigos/ranking', heading: 'Ranking', exact: true },
  { name: 'perfil', path: '/perfil', heading: 'Meu perfil' },
  { name: 'usuarios', path: '/usuarios', heading: 'Usuários' },
  { name: 'whatsapp', path: '/whatsapp', heading: 'WhatsApp' },
  { name: 'validar', path: '/validar/token-invalido', heading: 'Link de validação inválido.' },
  { name: 'nao-encontrada', path: '/pagina-que-nao-existe', heading: 'Página não encontrada' },
];

const VIEWPORTS = [
  { name: 'celular', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

// Cor de fundo da página em cada tema (--color-bg em client/src/styles/theme.css)
const PAGE_BG = { light: 'rgb(246, 247, 249)', dark: 'rgb(15, 18, 22)' };

// Palavras em inglês que não deveriam aparecer na interface
const ENGLISH =
  /\b(Loading|Error|Submit|Save|Cancel|Delete|Remove|Edit|Login|Log in|Logout|Sign (in|out)|Password|Username|Settings|Profile|Users|Home|Today|Next|Previous|Back|Close|Not found|Something went wrong|Retry|Yes|No)\b/;

async function openActivityDialog(page) {
  await page.locator('[data-add-date]').first().click();
}

test.beforeAll(async () => {
  // Dados para as telas não ficarem vazias: um usuário comum com uma atividade
  const user = await createUser('revisao');
  await prisma.activity.create({
    data: {
      userId: user.id,
      name: 'Atividade com um nome bem comprido para testar a quebra de linha no celular',
      hour: 6,
      minute: 30,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: tomorrow(),
    },
  });
});

for (const scheme of ['light', 'dark']) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${scheme} · ${viewport.name}`, () => {
      test.use({ colorScheme: scheme, viewport });

      for (const screen of SCREENS) {
        test(screen.name, async ({ page }, testInfo) => {
          if (!screen.public) {
            const res = await page.request.post('/api/auth/login', { data: ADMIN });
            expect(res.ok()).toBe(true);
          }
          await page.goto(screen.path);
          await screen.open?.(page);
          await expect(
            page.getByRole('heading', { name: screen.heading, exact: screen.exact }),
          ).toBeVisible();
          await page.waitForLoadState('networkidle');

          // pt-BR
          await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
          const text = await page.locator('body').innerText();
          expect(text, 'texto em inglês na tela').not.toMatch(ENGLISH);

          // Tema: segue o sistema e pinta a página com as cores do tema
          await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
          await expect(page.locator('body')).toHaveCSS('background-color', PAGE_BG[scheme]);

          // Responsividade: nada mais largo que a tela
          const overflow = await page.evaluate(() => {
            const width = document.documentElement.clientWidth;
            const wide = [...document.querySelectorAll('body *')]
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && (r.right > width + 1 || r.left < -1);
              })
              .filter((el) => !el.closest('.sr-only') && el.className !== 'sr-only')
              .slice(0, 5)
              .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
            return { scroll: document.documentElement.scrollWidth - width, wide };
          });
          expect(
            overflow.scroll,
            `rolagem horizontal: ${overflow.wide.join(', ')}`,
          ).toBeLessThanOrEqual(0);
          expect(overflow.wide).toEqual([]);

          await page.screenshot({ path: testInfo.outputPath('tela.png'), fullPage: true });
        });
      }
    });
  }
}

test('botão de tema alterna claro/escuro e lembra a escolha', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.request.post('/api/auth/login', { data: ADMIN });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Ativar modo escuro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', PAGE_BG.dark);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Ativar modo claro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});
