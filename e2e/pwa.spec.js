// PWA leve (UX-05): manifest, ícones e theme-color acompanhando o tema do app.
import { test, expect } from '@playwright/test';
import { themeColor } from './helpers.js';

const ADMIN = { username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASSWORD };

/** rgb(...) de uma cor hex, no formato do getComputedStyle. */
function rgb(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const themeColors = (page) =>
  page.$$eval('meta[name="theme-color"]', (metas) =>
    metas.map((m) => ({ content: m.content, media: m.getAttribute('media') })),
  );

test('manifest e ícones são servidos e referenciados no index.html', async ({ page, request }) => {
  await page.goto('/login');

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  const res = await request.get(manifestHref);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    short_name: 'Goals',
    lang: 'pt-BR',
    display: 'standalone',
    start_url: '/',
  });
  expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true);
  expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);

  const icons = [
    ...manifest.icons.map((i) => i.src),
    await page.getAttribute('link[rel="apple-touch-icon"]', 'href'),
    await page.getAttribute('link[rel="icon"][type="image/svg+xml"]', 'href'),
  ];
  for (const src of icons) {
    const icon = await request.get(src);
    expect(icon.ok(), src).toBe(true);
    expect(icon.headers()['content-type'], src).toMatch(/^image\//);
  }

  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
});

for (const scheme of ['light', 'dark']) {
  test(`theme-color segue o cabeçalho e o botão de tema (sistema ${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const res = await page.request.post('/api/auth/login', { data: ADMIN });
    expect(res.ok()).toBe(true);
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();

    const check = async () => {
      const metas = await themeColors(page);
      expect(metas.length).toBeGreaterThan(0);
      const surface = await themeColor(page, '--color-surface');
      for (const meta of metas) {
        expect(meta.media).toBeNull();
        expect(rgb(meta.content)).toBe(surface);
      }
      return metas[0].content;
    };

    const before = await check();
    const toggle = page.getByRole('button', {
      name: scheme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro',
    });
    await toggle.click();
    const after = await check();
    expect(after).not.toBe(before);

    // A escolha salva vale também no próximo carregamento (script inline do index.html)
    await page.reload();
    expect(await check()).toBe(after);
  });
}
