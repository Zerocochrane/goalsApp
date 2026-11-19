// Navegação no celular (UX-03): barra de abas fixa no rodapé. Em 320px as 5 abas do
// admin aparecem inteiras, sem rolagem horizontal; no desktop fica no topo.
import { test, expect } from '@playwright/test';

const ADMIN = { username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASSWORD };

async function login(page) {
  const res = await page.request.post('/api/auth/login', { data: ADMIN });
  expect(res.ok()).toBe(true);
}

/** Medidas da barra e de cada aba (rótulo visível cortado = scrollWidth > clientWidth). */
function measureNav(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.app-nav');
    const navRect = nav.getBoundingClientRect();
    return {
      nav: {
        top: navRect.top,
        bottom: navRect.bottom,
        scrollWidth: nav.scrollWidth,
        clientWidth: nav.clientWidth,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageScrollWidth: document.documentElement.scrollWidth,
      links: [...nav.querySelectorAll('a')].map((a) => {
        const r = a.getBoundingClientRect();
        const label = [...a.querySelectorAll('span')].find((s) => s.getClientRects().length);
        return {
          // Só o rótulo (o contador da aba, se houver, fica de fora)
          text: label.textContent.trim(),
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
          truncated: label.scrollWidth > label.clientWidth,
        };
      }),
    };
  });
}

for (const width of [320, 344, 375, 414]) {
  test(`${width}px: abas no rodapé, inteiras e sem rolagem`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await login(page);
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();

    const m = await measureNav(page);
    expect(m.links.map((l) => l.text)).toEqual([
      'Início',
      'Amigos',
      'Usuários',
      'WhatsApp',
      'Perfil',
    ]);
    expect(m.nav.scrollWidth).toBeLessThanOrEqual(m.nav.clientWidth);
    expect(m.pageScrollWidth).toBeLessThanOrEqual(width);
    expect(Math.round(m.nav.bottom)).toBe(m.viewport.height);
    for (const link of m.links) {
      expect(link.left).toBeGreaterThanOrEqual(0);
      expect(link.right).toBeLessThanOrEqual(width + 0.5);
      expect(link.width).toBeGreaterThanOrEqual(44);
      expect(link.height).toBeGreaterThanOrEqual(44);
      expect(link.truncated, link.text).toBe(false);
    }

    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav.getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');

    // Rolando até o fim, o último conteúdo não fica escondido atrás da barra
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastBottom = await page.evaluate(() => {
      const main = document.querySelector('.app-main');
      const last = main.lastElementChild?.lastElementChild ?? main.lastElementChild;
      return last.getBoundingClientRect().bottom;
    });
    expect(lastBottom).toBeLessThanOrEqual(m.nav.top + 0.5);
  });
}

test('desktop: abas no topo com rótulos completos', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
  const m = await measureNav(page);
  expect(m.links.map((l) => l.text)).toEqual([
    'Início',
    'Amigos',
    'Usuários',
    'WhatsApp',
    'Meu perfil',
  ]);
  expect(m.nav.top).toBeLessThan(200);
  await expect(page.locator('.app-nav-icon').first()).toBeHidden();
});
