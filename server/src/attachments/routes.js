// Anexo da atividade (montado em /api/activities/:id/attachment):
//   POST   multipart (campo "file"): envia ou substitui — foto JPG/PNG/WebP ou PDF, até 5 MB
//   GET    devolve o arquivo (inline; ?download=1 para baixar)
//   DELETE remove
// Só o dono da atividade enxerga ou altera o anexo; para os outros, 404 (nem revela que
// a atividade existe). Amigos nunca veem anexos.
import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../db/prisma.js';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, prepareAttachment } from './files.js';
import {
  cleanOriginalName,
  contentDisposition,
  isStoredName,
  removeFiles,
  saveFile,
  uploadDir,
} from './storage.js';

export const attachmentSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  createdAt: true,
};

const NOT_FOUND = 'Atividade não encontrada';
const NO_ATTACHMENT = 'Esta atividade não tem anexo';
export const INVALID_FILE = 'Envie uma foto (JPG, PNG ou WebP) ou um PDF de até 5 MB.';
export const HEIC_FILE =
  'Fotos HEIC não são aceitas. Envie a foto em JPG (no iPhone: Ajustes › Câmera › Formatos › Mais Compatível).';
const NO_FILE = 'Escolha uma foto ou um PDF para enviar.';

// Arquivo em memória (até 5 MB): é preciso ler o conteúdo inteiro para conferir o tipo e
// remover os metadados antes de gravar
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0, parts: 2 },
  defParamCharset: 'utf8', // nomes com acento
}).single('file');

function parseId(raw) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function ownActivity(req) {
  const id = parseId(req.params.id);
  return id
    ? prisma.activity.findFirst({
        where: { id, userId: req.user.id, active: true },
        select: { id: true },
      })
    : null;
}

/** Roda o multer e traduz os erros dele para respostas em pt-BR. */
function receiveFile(req, res) {
  return new Promise((resolve) => {
    upload(req, res, (err) => {
      if (!err) return resolve(true);
      if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        res.status(status).json({ error: INVALID_FILE });
      } else {
        res.status(400).json({ error: INVALID_FILE });
      }
      resolve(false);
    });
  });
}

export function attachmentRoutes() {
  const router = Router({ mergeParams: true });

  // Até 30 envios por hora por usuário (cada um pode ter 5 MB)
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: { error: 'Muitos envios de anexo em pouco tempo. Tente novamente mais tarde.' },
  });

  router.post('/', uploadLimiter, async (req, res) => {
    // Confere o dono antes de receber o arquivo
    const activity = await ownActivity(req);
    if (!activity) {
      req.resume(); // descarta o corpo
      return res.status(404).json({ error: NOT_FOUND });
    }
    if (!(await receiveFile(req, res))) return;
    if (!req.file) return res.status(400).json({ error: NO_FILE });

    const prepared = prepareAttachment(req.file.buffer);
    if (prepared.error) {
      return res.status(415).json({ error: prepared.error === 'heic' ? HEIC_FILE : INVALID_FILE });
    }
    const { ext } = ATTACHMENT_TYPES[prepared.mimeType];
    const storedName = await saveFile(prepared.buffer, ext);

    let previous;
    let attachment;
    try {
      ({ previous, attachment } = await prisma.$transaction(async (tx) => {
        // A atividade pode ter sido editada/excluída enquanto o arquivo chegava
        const still = await tx.activity.findFirst({
          where: { id: activity.id, userId: req.user.id, active: true },
          select: { id: true },
        });
        if (!still) return {};
        const old = await tx.attachment.findUnique({
          where: { activityId: activity.id },
          select: { storedName: true },
        });
        if (old) await tx.attachment.delete({ where: { activityId: activity.id } });
        const created = await tx.attachment.create({
          data: {
            activityId: activity.id,
            userId: req.user.id,
            storedName,
            originalName: cleanOriginalName(req.file.originalname, ext),
            mimeType: prepared.mimeType,
            size: prepared.buffer.length,
            width: prepared.width,
            height: prepared.height,
          },
          select: attachmentSelect,
        });
        return { previous: old?.storedName, attachment: created };
      }));
    } catch (err) {
      await removeFiles([storedName]);
      throw err;
    }
    if (!attachment) {
      await removeFiles([storedName]);
      return res.status(404).json({ error: NOT_FOUND });
    }
    if (previous) await removeFiles([previous]);
    res.status(201).json({ attachment });
  });

  router.get('/', async (req, res) => {
    const id = parseId(req.params.id);
    const attachment =
      id &&
      (await prisma.attachment.findFirst({
        where: { activityId: id, userId: req.user.id, activity: { active: true } },
      }));
    if (!attachment || !isStoredName(attachment.storedName)) {
      return res.status(404).json({ error: NO_ATTACHMENT });
    }
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': attachment.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': contentDisposition(disposition, attachment.originalName),
      // Arquivo particular: o navegador pode guardar, mas confere antes de reutilizar
      'Cache-Control': 'private, no-cache',
      // Se alguém abrir o arquivo direto, ele não roda nada (fotos e PDF não precisam)
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    });
    // `root`: a checagem de "arquivos ocultos" do send vale só para o nome do arquivo
    // (o caminho da pasta pode ter partes com ponto, ex.: .data)
    res.sendFile(attachment.storedName, { root: uploadDir() }, (err) => {
      if (err && !res.headersSent) {
        for (const h of ['Content-Disposition', 'Content-Type', 'Content-Security-Policy'])
          res.removeHeader(h);
        console.error(`[anexos] arquivo ${attachment.storedName} indisponível:`, err.message);
        res.status(404).json({ error: NO_ATTACHMENT });
      }
    });
  });

  router.delete('/', async (req, res) => {
    const activity = await ownActivity(req);
    if (!activity) return res.status(404).json({ error: NOT_FOUND });
    const attachment = await prisma.attachment.findUnique({
      where: { activityId: activity.id },
      select: { storedName: true },
    });
    if (!attachment) return res.status(404).json({ error: NO_ATTACHMENT });
    await prisma.attachment.deleteMany({ where: { activityId: activity.id } });
    await removeFiles([attachment.storedName]);
    res.status(204).end();
  });

  return router;
}
