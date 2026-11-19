// Pasta dos anexos: server/data/uploads (o deploy não apaga server/data e o backup diário
// copia a pasta). Pode ser trocada com UPLOAD_DIR (os testes usam uma pasta temporária).
// Os arquivos têm nome aleatório; o nome enviado pela pessoa fica só no banco.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STORED_NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/;

export function uploadDir() {
  return path.resolve(SERVER_DIR, process.env.UPLOAD_DIR || 'data/uploads');
}

export function isStoredName(name) {
  return STORED_NAME_RE.test(name);
}

/** Grava o arquivo com um nome aleatório e devolve esse nome. */
export async function saveFile(buffer, ext) {
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  // 'wx': nunca sobrescreve um arquivo existente
  await fs.writeFile(path.join(dir, storedName), buffer, { flag: 'wx', mode: 0o600 });
  return storedName;
}

/** Apaga os arquivos (ignora os que já não existem; falhas só vão para o log). */
export async function removeFiles(storedNames) {
  await Promise.all(
    storedNames.filter(isStoredName).map(async (name) => {
      try {
        await fs.rm(path.join(uploadDir(), name), { force: true });
      } catch (err) {
        console.error(`[anexos] não foi possível apagar ${name}:`, err.message);
      }
    }),
  );
}

/** Nomes dos arquivos de um usuário (para apagar depois de excluir a conta). */
export async function userStoredNames(prisma, userId) {
  const rows = await prisma.attachment.findMany({
    where: { userId },
    select: { storedName: true },
  });
  return rows.map((row) => row.storedName);
}

/**
 * Nome original "limpo" para mostrar e para o Content-Disposition: sem pastas nem
 * caracteres de controle, até 120 caracteres, com a extensão do tipo real.
 */
export function cleanOriginalName(raw, ext) {
  let name = String(raw ?? '')
    .split(/[/\\]/) // sem pastas (barra normal ou invertida)
    .pop()
    .replace(/[\p{Cc}\p{Cf}"]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/\.[^.]{1,10}$/, ''); // a extensão vem do conteúdo, não do nome
  if (!name) name = 'anexo';
  return `${name.slice(0, 120)}.${ext}`;
}

/** Content-Disposition com o nome em ASCII e em UTF-8 (RFC 6266 / 5987). */
export function contentDisposition(type, filename) {
  const ascii =
    filename
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[\\"]/g, '') || 'anexo';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
