// Descrição, link de vídeo e anexo da atividade (#33): preencher, enviar foto e PDF,
// abrir dentro do app, remover; no celular, o botão "Tirar foto" (câmera traseira).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, devices } from '@playwright/test';
import { createUser, dayColumn, PASSWORD, prisma, tomorrow } from './helpers.js';
import { makePdf, makePng } from '../server/test/helpers/files.js';
import { E2E_DATA_DIR } from '../playwright.config.js';

const UPLOADS = path.join(E2E_DATA_DIR, 'uploads');
const uploadedFiles = () => (fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : []);

test.use({ reducedMotion: 'reduce' });

async function setup(page, name = 'Treino de pernas') {
  const user = await createUser('anexo');
  const activity = await prisma.activity.create({
    data: {
      userId: user.id,
      name,
      hour: 7,
      minute: 30,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: tomorrow(),
    },
  });
  const res = await page.request.post('/api/auth/login', {
    data: { username: user.username, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  return { user, activity };
}

async function openEdit(page, name) {
  await page.goto('/');
  const column = await dayColumn(page, tomorrow());
  await column.getByRole('button', { name: new RegExp(`^Editar ${name}`) }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar atividade' });
  await expect(dialog.getByLabel('Nome')).toHaveValue(name);
  return dialog;
}

async function saveAndWait(page, dialog) {
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/atualizada\./)).toBeVisible();
}

test('descrição (com quebras de linha) e vídeo do YouTube incorporado', async ({ page }) => {
  const { activity } = await setup(page);
  let dialog = await openEdit(page, 'Treino de pernas');

  const description = dialog.getByLabel('Descrição');
  await description.fill('Série A:\n- agachamento\n- leg press');
  await expect(dialog.locator('.field-counter')).toHaveText('34/1.000');

  const video = dialog.getByLabel('Link do vídeo');
  await video.fill('http://youtube.com/watch?v=dQw4w9WgXcQ');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByText('Informe um link válido, começando com https://')).toBeVisible();
  await expect(video).toBeFocused();

  await video.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s');
  const frame = dialog.locator('.video-embed iframe');
  await expect(frame).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=65',
  );
  await expect(frame).toHaveAttribute('title', 'Vídeo (YouTube): Treino de pernas');
  await saveAndWait(page, dialog);

  // Ícones na linha do calendário (com nome acessível)
  const row = (await dayColumn(page, tomorrow())).getByRole('button', {
    name: /^Editar Treino de pernas/,
  });
  await expect(row).toHaveAccessibleName(/tem descrição, tem vídeo$/);
  await expect(row.locator('.activity-extra-video')).toBeVisible();
  await expect(row.locator('.activity-extra-description')).toBeVisible();

  const saved = await prisma.activity.findUnique({ where: { id: activity.id } });
  expect(saved.description).toBe('Série A:\n- agachamento\n- leg press');

  // Outros sites: botão "Abrir vídeo" em nova aba
  dialog = await openEdit(page, 'Treino de pernas');
  await expect(dialog.getByLabel('Descrição')).toHaveValue('Série A:\n- agachamento\n- leg press');
  await dialog.getByLabel('Link do vídeo').fill('https://exemplo.com.br/aula.mp4');
  const link = dialog.getByRole('link', { name: 'Abrir vídeo em nova aba' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(dialog.locator('.video-embed')).toHaveCount(0);
});

test('foto: prévia, envio, abrir em tela cheia com zoom, substituir por PDF e remover', async ({
  page,
}) => {
  const { activity } = await setup(page, 'Alongamento');
  let dialog = await openEdit(page, 'Alongamento');

  // Desktop: só "Escolher arquivo" (sem "Tirar foto")
  await expect(dialog.getByRole('button', { name: 'Tirar foto' })).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Escolher arquivo' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'postura.png',
    mimeType: 'image/png',
    buffer: makePng({ width: 120, height: 80 }),
  });
  await expect(dialog.getByRole('img', { name: 'Prévia da foto postura.png' })).toBeVisible();
  await expect(dialog.getByText('Será enviado ao salvar.')).toBeVisible();
  await saveAndWait(page, dialog);

  const attachment = await prisma.attachment.findUnique({ where: { activityId: activity.id } });
  expect(attachment).toMatchObject({ originalName: 'postura.png', mimeType: 'image/png' });
  expect(uploadedFiles()).toContain(attachment.storedName);
  await expect(
    (await dayColumn(page, tomorrow())).getByRole('button', {
      name: /^Editar Alongamento.*tem foto anexada$/,
    }),
  ).toBeVisible();

  // Abrir em tela cheia
  dialog = await openEdit(page, 'Alongamento');
  await expect(dialog.getByRole('img', { name: 'Foto anexada: postura.png' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abrir anexo postura.png' }).click();
  const viewer = page.getByRole('dialog', { name: 'postura.png' });
  const photo = viewer.getByRole('img', { name: 'postura.png' });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img) => img.naturalWidth)).toBe(120);
  await expect(viewer.getByRole('link', { name: 'Baixar' })).toHaveAttribute('href', /download=1/);
  // Zoom (roda do mouse e botões)
  await viewer.locator('.viewer-photo-stage').hover();
  await page.mouse.wheel(0, -400);
  await expect(viewer.getByRole('button', { name: 'Tamanho original' })).not.toHaveText('100%');
  await viewer.getByRole('button', { name: 'Tamanho original' }).click();
  await expect(viewer.getByRole('button', { name: 'Tamanho original' })).toHaveText('100%');
  await viewer.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect(viewer.getByRole('button', { name: 'Tamanho original' })).toHaveText('150%');
  // Esc fecha só o visualizador
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(dialog).toBeVisible();

  // Substituir por um PDF (com confirmação)
  const chooser2 = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Trocar arquivo' }).click();
  await (
    await chooser2
  ).setFiles({ name: 'ficha.pdf', mimeType: 'application/pdf', buffer: makePdf() });
  const confirm = page.getByRole('dialog', { name: 'Substituir anexo?' });
  await expect(confirm).toContainText('postura.png');
  await confirm.getByRole('button', { name: 'Substituir' }).click();
  await expect(dialog.getByText('Substituirá o anexo atual ao salvar.')).toBeVisible();
  await saveAndWait(page, dialog);
  const replaced = await prisma.attachment.findUnique({ where: { activityId: activity.id } });
  expect(replaced.mimeType).toBe('application/pdf');
  expect(uploadedFiles()).not.toContain(attachment.storedName);

  // Remover (com confirmação): o arquivo some do disco
  dialog = await openEdit(page, 'Alongamento');
  await dialog.getByRole('button', { name: 'Remover anexo ficha.pdf' }).click();
  const removeConfirm = page.getByRole('dialog', { name: 'Remover anexo?' });
  await removeConfirm.getByRole('button', { name: 'Remover' }).click();
  await expect(removeConfirm).toBeHidden();
  await expect(dialog.getByText('Anexo removido.')).toBeVisible();
  expect(await prisma.attachment.count({ where: { activityId: activity.id } })).toBe(0);
  expect(uploadedFiles()).not.toContain(replaced.storedName);
  // Fechar recarrega o calendário (sem o ícone do anexo)
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Anexo removido.')).toBeVisible();
  await expect(
    (await dayColumn(page, tomorrow())).getByRole('button', { name: /^Editar Alongamento/ }),
  ).not.toHaveAccessibleName(/anexad/);
});

test('PDF abre dentro do app (PDF.js) e outro usuário não acessa o arquivo', async ({
  page,
  browser,
}) => {
  const { activity } = await setup(page, 'Ficha de treino');
  const dialog = await openEdit(page, 'Ficha de treino');
  await dialog
    .locator('[data-testid="attachment-file-input"]')
    .setInputFiles({ name: 'ficha.pdf', mimeType: 'application/pdf', buffer: makePdf() });
  await saveAndWait(page, dialog);

  const edit = await openEdit(page, 'Ficha de treino');
  await edit.getByRole('button', { name: 'Abrir anexo ficha.pdf' }).click();
  const viewer = page.getByRole('dialog', { name: 'ficha.pdf' });
  const pageCanvas = viewer.getByRole('img', { name: 'Página 1 de 1' });
  await expect(pageCanvas).toBeVisible();
  // A página foi desenhada (texto preto sobre fundo branco)
  await expect
    .poll(() =>
      pageCanvas.evaluate((canvas) => {
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 3] > 0) dark++;
        return dark;
      }),
    )
    .toBeGreaterThan(50);
  await viewer.getByRole('button', { name: 'Fechar' }).click();
  await expect(viewer).toBeHidden();

  // Outro usuário (sessão própria): 404
  const other = await createUser('intruso');
  const context = await browser.newContext();
  const login = await context.request.post('/api/auth/login', {
    data: { username: other.username, password: PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const res = await context.request.get(`/api/activities/${activity.id}/attachment`);
  expect(res.status()).toBe(404);
  await context.close();
});

test('arquivo de tipo errado é recusado com mensagem clara', async ({ page }) => {
  await setup(page, 'Leitura');
  const dialog = await openEdit(page, 'Leitura');
  await dialog.locator('[data-testid="attachment-file-input"]').setInputFiles({
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('isto não é uma foto'),
  });
  await expect(
    dialog.getByText('Envie uma foto (JPG, PNG ou WebP) ou um PDF de até 5 MB.'),
  ).toBeVisible();
  await expect(dialog.locator('.attachment-card')).toHaveCount(0);
});

test.describe('celular', () => {
  const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  test('"Tirar foto" abre a câmera traseira; foto grande é reduzida antes do envio', async ({
    page,
  }) => {
    const { activity } = await setup(page, 'Caminhada');
    const dialog = await openEdit(page, 'Caminhada');

    const camera = dialog.locator('[data-testid="attachment-camera-input"]');
    await expect(camera).toHaveAttribute('accept', 'image/*');
    await expect(camera).toHaveAttribute('capture', 'environment');
    await expect(dialog.locator('[data-testid="attachment-file-input"]')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp,application/pdf',
    );

    const takePhoto = dialog.getByRole('button', { name: 'Tirar foto' });
    const box = await takePhoto.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);

    // "Foto da câmera": 3000 × 2000 px (maior que o limite de 2000 px do lado maior)
    const chooser = page.waitForEvent('filechooser');
    await takePhoto.click();
    const fileChooser = await chooser;
    expect(fileChooser.isMultiple()).toBe(false);
    await fileChooser.setFiles({
      name: 'IMG_20261119.png',
      mimeType: 'image/png',
      buffer: makePng({ width: 3000, height: 2000, rgb: [30, 120, 200] }),
    });
    await expect(
      dialog.getByRole('img', { name: /Prévia da foto IMG_20261119\.jpg/ }),
    ).toBeVisible();
    await saveAndWait(page, dialog);

    const attachment = await prisma.attachment.findUnique({ where: { activityId: activity.id } });
    expect(attachment).toMatchObject({
      mimeType: 'image/jpeg',
      originalName: 'IMG_20261119.jpg',
      width: 2000,
      height: 1333,
    });

    // Abre em tela cheia no celular
    const again = await openEdit(page, 'Caminhada');
    await again.getByRole('button', { name: 'Abrir anexo IMG_20261119.jpg' }).click();
    const viewer = page.getByRole('dialog', { name: 'IMG_20261119.jpg' });
    await expect(viewer.getByRole('img', { name: 'IMG_20261119.jpg' })).toBeVisible();
    const viewerBox = await viewer.boundingBox();
    expect(Math.round(viewerBox.width)).toBe(page.viewportSize().width);
    await viewer.getByRole('button', { name: 'Fechar' }).click();
    await expect(viewer).toBeHidden();
  });
});
