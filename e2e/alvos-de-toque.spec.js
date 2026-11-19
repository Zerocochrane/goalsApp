// Alvos de toque no celular (UX-01): em 320–414px nenhum controle interativo visível
// pode ser menor que 44×44px.
import { test, expect } from '@playwright/test';
import { prisma, tomorrow } from './helpers.js';

const ADMIN = { username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASSWORD };
const MIN = 44;

const SCREENS = [
  { name: 'login', path: '/login', heading: 'Entrar', public: true },
  { name: 'cadastro', path: '/cadastro', heading: 'Criar conta', public: true },
  { name: 'inicio', path: '/', heading: 'Início' },
  {
    name: 'nova-atividade',
    path: '/',
    heading: 'Nova atividade',
    open: (page) => page.locator('[data-add-date]').first().click(),
  },
  { name: 'amigos', path: '/amigos', heading: 'Amigos', exact: true },
  { name: 'ranking', path: '/amigos/ranking', heading: 'Ranking', exact: true },
  { name: 'perfil', path: '/perfil', heading: 'Meu perfil' },
  { name: 'usuarios', path: '/usuarios', heading: 'Usuários' },
  { name: 'whatsapp', path: '/whatsapp', heading: 'WhatsApp' },
  { name: 'nao-encontrada', path: '/pagina-que-nao-existe', heading: 'Página não encontrada' },
];

/** Controles visíveis menores que MIN px (largura ou altura). */
function smallTargets(page) {
  return page.evaluate((min) => {
    const selector = 'a[href], button, input, select, textarea, [role="button"], [tabindex="0"]';
    return [...document.querySelectorAll(selector)]
      .filter((el) => !el.closest('.sr-only') && el.getClientRects().length > 0)
      .map((el) => {
        // Checkbox dentro do rótulo (ex.: .weekday-option, "Manter conectado"): o toque
        // no rótulo inteiro marca, então o alvo é o rótulo
        const target = el.matches('label > input[type="checkbox"]') ? el.parentElement : el;
        const { width, height } = target.getBoundingClientRect();
        const name = (el.getAttribute('aria-label') || el.textContent || el.name || '').trim();
        return { name: `${el.tagName.toLowerCase()} "${name.slice(0, 40)}"`, width, height };
      })
      .filter(({ width, height }) => width < min - 0.5 || height < min - 0.5)
      .map(({ name, width, height }) => `${name}: ${Math.round(width)}×${Math.round(height)}`);
  }, MIN);
}

test.beforeAll(async () => {
  // Uma atividade do admin para o calendário ter linhas clicáveis
  const admin = await prisma.user.findUnique({ where: { username: ADMIN.username } });
  await prisma.activity.create({
    data: {
      userId: admin.id,
      name: 'Atividade com um nome bem comprido para testar a quebra de linha no celular',
      hour: 7,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: tomorrow(),
    },
  });
});

for (const width of [320, 375, 414]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const screen of SCREENS) {
      test(screen.name, async ({ page }) => {
        if (!screen.public) {
          const res = await page.request.post('/api/auth/login', { data: ADMIN });
          expect(res.ok()).toBe(true);
        }
        await page.goto(screen.path);
        if (screen.path === '/') await page.locator('.week-grid').waitFor();
        await screen.open?.(page);
        await expect(
          page.getByRole('heading', { name: screen.heading, exact: screen.exact }),
        ).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await smallTargets(page)).toEqual([]);
      });
    }
  });
}
