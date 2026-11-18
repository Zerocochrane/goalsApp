// Gera os PNGs do ícone (client/public) a partir dos SVGs, usando o Chromium do Playwright.
// Rode com `node scripts/gerar-icones.mjs` depois de alterar icon.svg ou icon-maskable.svg.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');

const outputs = [
  { svg: 'icon.svg', file: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', file: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', file: 'icon-maskable-512.png', size: 512 },
  // iOS arredonda os cantos sozinho: o ícone vai sem cantos nem transparência
  { svg: 'icon-maskable.svg', file: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { svg, file, size } of outputs) {
    const markup = await fs.readFile(path.join(PUBLIC, svg), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
    );
    await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: true });
    console.log(`${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
