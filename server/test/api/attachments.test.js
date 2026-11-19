// API: descrição, link de vídeo e anexo (foto/PDF) da atividade — issue #33.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/db.js';
import { makeHeic, makeJpeg, makePdf, makePng, makeWebp } from '../helpers/files.js';

// Pasta com um trecho começando com ponto (como e2e/.data ou .claude/…): o envio do
// arquivo não pode confundir isso com "arquivo oculto"
const uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-uploads-'));
const uploads = path.join(uploadsRoot, '.dados', 'uploads');
fs.mkdirSync(uploads, { recursive: true });
process.env.UPLOAD_DIR = uploads;

const db = await createTestDatabase('api-attachments');
const { buildApp, createUser, createActivity, loginAs, today, addDays } =
  await import('../helpers/api.js');
const { MAX_ATTACHMENT_BYTES } = await import('../../src/attachments/files.js');
const { backupUploads } = await import('../../src/backup/backup.js');

const INVALID = 'Envie uma foto (JPG, PNG ou WebP) ou um PDF de até 5 MB.';
const MB5 = 5 * 1024 * 1024;

const app = buildApp();
let ana, bia, asAna, asBia;

afterAll(async () => {
  await db.destroy();
  fs.rmSync(uploadsRoot, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.reset();
  for (const name of fs.readdirSync(uploads)) fs.rmSync(path.join(uploads, name));
  ana = await createUser(db.prisma, { username: 'ana' });
  bia = await createUser(db.prisma, { username: 'bia' });
  asAna = await loginAs(app, 'ana');
  asBia = await loginAs(app, 'bia');
});

const storedFiles = () => fs.readdirSync(uploads);

function upload(agent, activityId, buffer, filename = 'foto.jpg') {
  return agent
    .post(`/api/activities/${activityId}/attachment`)
    .attach('file', buffer, { filename, contentType: 'application/octet-stream' });
}

/** Lê o corpo binário da resposta do Supertest. */
function binary(req) {
  return req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('descrição e link de vídeo', () => {
  test('cria e edita com descrição (quebras de linha preservadas) e vídeo', async () => {
    const res = await asAna.post('/api/activities').send({
      name: 'Academia',
      hour: 7,
      minute: 0,
      weekdays: [1],
      description: '  Série A:\r\n- agachamento\n- leg press  ',
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
    });
    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({
      description: 'Série A:\n- agachamento\n- leg press',
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      attachment: null,
    });

    const put = await asAna
      .put(`/api/activities/${res.body.activity.id}`)
      .send({ description: '', videoUrl: null });
    expect(put.status).toBe(200);
    expect(put.body.activity).toMatchObject({ description: null, videoUrl: null });
  });

  test('descrição com HTML é guardada como texto puro (sem interpretar)', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await asAna
      .put(`/api/activities/${activity.id}`)
      .send({ description: '<img src=x onerror=alert(1)>' });
    expect(res.body.activity.description).toBe('<img src=x onerror=alert(1)>');
  });

  test.each([
    [
      { description: 'x'.repeat(1001) },
      'description',
      'A descrição deve ter no máximo 1.000 caracteres',
    ],
    [{ description: 42 }, 'description', 'Descrição inválida'],
    [
      { videoUrl: 'http://youtube.com/watch?v=abc' },
      'videoUrl',
      'Informe um link de vídeo válido, começando com https://',
    ],
    [
      { videoUrl: 'javascript:alert(1)' },
      'videoUrl',
      'Informe um link de vídeo válido, começando com https://',
    ],
    [
      { videoUrl: 'youtube.com/watch?v=abc' },
      'videoUrl',
      'Informe um link de vídeo válido, começando com https://',
    ],
    [
      { videoUrl: 'https://user:senha@vimeo.com/1' },
      'videoUrl',
      'Informe um link de vídeo válido, começando com https://',
    ],
    [
      { videoUrl: 'https://localhost/video' },
      'videoUrl',
      'Informe um link de vídeo válido, começando com https://',
    ],
    [
      { videoUrl: `https://vimeo.com/${'1'.repeat(500)}` },
      'videoUrl',
      'Informe um link de vídeo válido, começando com https://',
    ],
  ])('validação: %j → 400', async (patch, field, message) => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await asAna.put(`/api/activities/${activity.id}`).send(patch);
    expect(res.status).toBe(400);
    expect(res.body.fields[field]).toBe(message);
  });

  test('1.000 caracteres exatos são aceitos', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await asAna
      .put(`/api/activities/${activity.id}`)
      .send({ description: 'x'.repeat(1000) });
    expect(res.status).toBe(200);
  });

  test('mudar só descrição/vídeo de atividade que já valeu não cria nova versão', async () => {
    const activity = await createActivity(db.prisma, ana.id, { startDate: addDays(today(), -7) });
    const res = await asAna
      .put(`/api/activities/${activity.id}`)
      .send({ name: 'Academia', description: 'Levar toalha' });
    expect(res.status).toBe(200);
    expect(res.body.activity).toMatchObject({ id: activity.id, description: 'Levar toalha' });
    expect(await db.prisma.activity.count()).toBe(1);
  });

  test('calendário indica descrição, vídeo e tipo do anexo (sem o conteúdo)', async () => {
    const activity = await createActivity(db.prisma, ana.id, {
      description: 'Detalhes',
      videoUrl: 'https://vimeo.com/76979871',
    });
    await upload(asAna, activity.id, makePdf(), 'treino.pdf').expect(201);
    const cal = await asAna.get(`/api/calendar?start=${today()}&end=${today()}`);
    const [item] = cal.body.days[0].activities;
    expect(item).toMatchObject({ hasDescription: true, hasVideo: true, attachment: 'pdf' });
    expect(item.description).toBeUndefined();
  });
});

describe('POST /api/activities/:id/attachment', () => {
  test('foto JPEG: salva com nome aleatório, sem EXIF/GPS/XMP/comentário, mantém a orientação', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const original = makeJpeg({ width: 400, height: 300, orientation: 6 });
    const res = await upload(asAna, activity.id, original, '../../IMG_0001 (cópia).jpeg');
    expect(res.status).toBe(201);
    // Orientação 6 = girada 90°: aparece em pé (300 × 400)
    expect(res.body.attachment).toMatchObject({
      originalName: 'IMG_0001 (cópia).jpg',
      mimeType: 'image/jpeg',
      width: 300,
      height: 400,
    });

    const [stored] = storedFiles();
    expect(stored).toMatch(/^[a-f0-9]{32}\.jpg$/);
    const saved = fs.readFileSync(path.join(uploads, stored));
    expect(saved.length).toBe(res.body.attachment.size);
    expect(saved.length).toBeLessThan(original.length);
    const text = saved.toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('xmpmeta');
    expect(text).not.toContain('coment');
    expect(text).toContain('JFIF');
    // EXIF mínimo, só com a orientação (6)
    const exif = saved.indexOf('Exif\0\0');
    expect(exif).toBeGreaterThan(0);
    expect(saved.readUInt16BE(exif + 6 + 18)).toBe(6);
  });

  test('PNG e WebP: metadados removidos, dimensões lidas', async () => {
    const a1 = await createActivity(db.prisma, ana.id);
    const png = await upload(asAna, a1.id, makePng({ width: 40, height: 30 }), 'tela.png');
    expect(png.status).toBe(201);
    expect(png.body.attachment).toMatchObject({ mimeType: 'image/png', width: 40, height: 30 });

    const a2 = await createActivity(db.prisma, ana.id, { name: 'Outra' });
    const webp = await upload(asAna, a2.id, makeWebp({ width: 64, height: 48 }), 'f.webp');
    expect(webp.status).toBe(201);
    expect(webp.body.attachment).toMatchObject({ mimeType: 'image/webp', width: 64, height: 48 });

    for (const name of storedFiles()) {
      const text = fs.readFileSync(path.join(uploads, name)).toString('latin1');
      expect(text).not.toContain('GPS');
      expect(text).not.toContain('Fulano');
    }
    const webpFile = storedFiles().find((n) => n.endsWith('.webp'));
    const webpSaved = fs.readFileSync(path.join(uploads, webpFile));
    expect(webpSaved.readUInt32LE(4)).toBe(webpSaved.length - 8); // tamanho RIFF corrigido
    expect(webpSaved[20] & 0x0c).toBe(0); // VP8X sem indicadores de EXIF/XMP
  });

  test('PDF: aceito como está', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const pdf = makePdf();
    const res = await upload(asAna, activity.id, pdf, 'Treino.PDF');
    expect(res.status).toBe(201);
    expect(res.body.attachment).toMatchObject({
      originalName: 'Treino.pdf',
      mimeType: 'application/pdf',
      size: pdf.length,
      width: null,
    });
  });

  test('5 MB exatos são aceitos; 1 byte a mais é recusado', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const ok = await upload(asAna, activity.id, makePdf({ size: MB5 }), 'grande.pdf');
    expect(MAX_ATTACHMENT_BYTES).toBe(MB5);
    expect(ok.status).toBe(201);
    expect(ok.body.attachment.size).toBe(MB5);

    const big = await upload(asAna, activity.id, makePdf({ size: MB5 + 1 }), 'grande.pdf');
    expect(big.status).toBe(413);
    expect(big.body.error).toBe(INVALID);
    expect(storedFiles()).toHaveLength(1); // o anterior continua
  });

  test.each([
    ['extensão falsa (texto como .jpg)', Buffer.from('não sou uma foto'), 'foto.jpg'],
    ['HTML com extensão .pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'a.pdf'],
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'), 'a.gif'],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg'],
    ['JPEG truncado', makeJpeg().subarray(0, 40), 'a.jpg'],
    ['arquivo vazio', Buffer.alloc(0), 'a.jpg'],
  ])('recusa %s', async (_label, buffer, filename) => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await upload(asAna, activity.id, buffer, filename);
    expect([400, 415]).toContain(res.status);
    expect(res.body.error).toBe(INVALID);
    expect(storedFiles()).toHaveLength(0);
    expect(await db.prisma.attachment.count()).toBe(0);
  });

  test('HEIC do iPhone: pede JPG', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await upload(asAna, activity.id, makeHeic(), 'IMG_1234.HEIC');
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/HEIC.*JPG/);
  });

  test('sem arquivo → 400', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await asAna.post(`/api/activities/${activity.id}/attachment`).field('x', '1');
    expect(res.status).toBe(400);
  });

  test('substituir troca o arquivo e apaga o antigo', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    await upload(asAna, activity.id, makeJpeg(), 'a.jpg').expect(201);
    const [first] = storedFiles();
    const res = await upload(asAna, activity.id, makePdf(), 'b.pdf');
    expect(res.status).toBe(201);
    expect(storedFiles()).toEqual([expect.stringMatching(/\.pdf$/)]);
    expect(storedFiles()).not.toContain(first);
    expect(await db.prisma.attachment.count()).toBe(1);
  });

  test('atividade de outro usuário → 404 (nada é salvo)', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const res = await upload(asBia, activity.id, makeJpeg());
    expect(res.status).toBe(404);
    expect(storedFiles()).toHaveLength(0);
  });

  test('sem login → 401', async () => {
    const { default: request } = await import('supertest');
    const activity = await createActivity(db.prisma, ana.id);
    const res = await request(app)
      .post(`/api/activities/${activity.id}/attachment`)
      .attach('file', makeJpeg(), 'a.jpg');
    expect(res.status).toBe(401);
  });

  test('limite de envios por usuário (30 por hora)', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const png = makePng({ width: 2, height: 2 });
    for (let i = 0; i < 30; i++) await upload(asAna, activity.id, png, 'a.png').expect(201);
    const res = await upload(asAna, activity.id, png, 'a.png');
    expect(res.status).toBe(429);
    // Outro usuário não é afetado
    const other = await createActivity(db.prisma, bia.id);
    expect((await upload(asBia, other.id, png, 'a.png')).status).toBe(201);
  });
});

describe('GET /api/activities/:id/attachment', () => {
  test('dono recebe o arquivo com tipo correto, nosniff e inline', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    const pdf = makePdf();
    await upload(asAna, activity.id, pdf, 'Treino de força.pdf').expect(201);

    const res = await binary(asAna.get(`/api/activities/${activity.id}/attachment`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe(
      `inline; filename="Treino de forca.pdf"; filename*=UTF-8''Treino%20de%20for%C3%A7a.pdf`,
    );
    expect(Buffer.compare(res.body, pdf)).toBe(0);

    const download = await asAna.get(`/api/activities/${activity.id}/attachment?download=1`);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
  });

  test('foto: devolve os bytes salvos (sem metadados) como image/jpeg', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    await upload(asAna, activity.id, makeJpeg()).expect(201);
    const res = await binary(asAna.get(`/api/activities/${activity.id}/attachment`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    const [stored] = storedFiles();
    expect(Buffer.compare(res.body, fs.readFileSync(path.join(uploads, stored)))).toBe(0);
  });

  test('arquivo sumiu do disco → 404 em JSON', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    await upload(asAna, activity.id, makeJpeg()).expect(201);
    for (const name of storedFiles()) fs.rmSync(path.join(uploads, name));
    const res = await asAna.get(`/api/activities/${activity.id}/attachment`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  test('outro usuário (inclusive amigo) → 404', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    await upload(asAna, activity.id, makeJpeg()).expect(201);
    await db.prisma.friendship.create({
      data: {
        requesterId: ana.id,
        addresseeId: bia.id,
        pairKey: `${Math.min(ana.id, bia.id)}:${Math.max(ana.id, bia.id)}`,
        status: 'aceita',
      },
    });
    const res = await asBia.get(`/api/activities/${activity.id}/attachment`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect((await asBia.delete(`/api/activities/${activity.id}/attachment`)).status).toBe(404);
    expect(storedFiles()).toHaveLength(1);
  });

  test('sem anexo → 404', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    expect((await asAna.get(`/api/activities/${activity.id}/attachment`)).status).toBe(404);
  });
});

describe('remoção do arquivo', () => {
  test('DELETE do anexo apaga o registro e o arquivo', async () => {
    const activity = await createActivity(db.prisma, ana.id);
    await upload(asAna, activity.id, makeJpeg()).expect(201);
    const res = await asAna.delete(`/api/activities/${activity.id}/attachment`);
    expect(res.status).toBe(204);
    expect(storedFiles()).toHaveLength(0);
    expect(await db.prisma.attachment.count()).toBe(0);
    expect((await asAna.delete(`/api/activities/${activity.id}/attachment`)).status).toBe(404);
  });

  test('excluir a atividade apaga o arquivo', async () => {
    const activity = await createActivity(db.prisma, ana.id, { startDate: addDays(today(), -3) });
    await upload(asAna, activity.id, makeJpeg()).expect(201);
    expect((await asAna.delete(`/api/activities/${activity.id}`)).status).toBe(204);
    expect(storedFiles()).toHaveLength(0);
    expect(await db.prisma.attachment.count()).toBe(0);
  });

  test('excluir o usuário (admin) apaga os arquivos dele', async () => {
    await createUser(db.prisma, { username: 'master', isMaster: true });
    const asMaster = await loginAs(app, 'master');
    const activity = await createActivity(db.prisma, ana.id);
    await upload(asAna, activity.id, makePdf(), 'a.pdf').expect(201);
    const biaActivity = await createActivity(db.prisma, bia.id);
    await upload(asBia, biaActivity.id, makeJpeg()).expect(201);

    expect((await asMaster.delete(`/api/users/${ana.id}`)).status).toBe(204);
    expect(storedFiles()).toEqual([expect.stringMatching(/\.jpg$/)]); // só o da Bia
  });

  test('editar atividade que já valeu: o anexo passa para a nova versão', async () => {
    const activity = await createActivity(db.prisma, ana.id, { startDate: addDays(today(), -7) });
    await upload(asAna, activity.id, makeJpeg()).expect(201);
    const res = await asAna.put(`/api/activities/${activity.id}`).send({ name: 'Corrida' });
    const newId = res.body.activity.id;
    expect(newId).not.toBe(activity.id);
    expect(res.body.activity.attachment).toMatchObject({ mimeType: 'image/jpeg' });
    expect((await asAna.get(`/api/activities/${newId}/attachment`)).status).toBe(200);
    expect((await asAna.get(`/api/activities/${activity.id}/attachment`)).status).toBe(404);
    expect(storedFiles()).toHaveLength(1);
  });
});

describe('backup dos anexos', () => {
  test('copia os novos e mantém os removidos só pelo prazo', async () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-upbackup-'));
    try {
      const activity = await createActivity(db.prisma, ana.id);
      await upload(asAna, activity.id, makeJpeg()).expect(201);
      const [name] = storedFiles();
      await backupUploads({ src: uploads, dest, days: 14 });
      expect(fs.readdirSync(dest)).toEqual([name]);

      await asAna.delete(`/api/activities/${activity.id}/attachment`).expect(204);
      await backupUploads({ src: uploads, dest, days: 14 });
      expect(fs.readdirSync(dest)).toEqual([name]); // ainda dentro do prazo
      const later = Date.now() + 15 * 24 * 60 * 60 * 1000;
      await backupUploads({ src: uploads, dest, days: 14, now: later });
      expect(fs.readdirSync(dest)).toEqual([]);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});
