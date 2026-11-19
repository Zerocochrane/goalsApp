// Anexo da atividade no navegador: conferência do tipo, redução de fotos grandes
// (lado maior ~2000px, JPEG ~80%) e envio com progresso e cancelamento.
import { ApiError } from './api.js';
import t from '../i18n/pt-BR.js';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPT_FILES = [...PHOTO_TYPES, 'application/pdf'].join(',');
const MAX_SIDE = 2000;

/** Erro com a mensagem pronta para mostrar. */
export class AttachmentError extends Error {}

function isHeic(file) {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** Tipo pelo cabeçalho do arquivo (o `type` do navegador pode vir vazio ou errado). */
async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(4, 8) === 'ftyp') return 'image/heic';
  // Conteúdo desconhecido: não confia na extensão nem no tipo informado pelo navegador
  return null;
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // cai para o <img> abaixo
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeOf = (image) => [image.width || image.naturalWidth, image.height || image.naturalHeight];

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Reduz a foto para JPEG com o lado maior ≤ 2000px (orientação do EXIF aplicada). */
async function shrink(file) {
  const image = await decode(file);
  const [width, height] = sizeOf(image);
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG transparente vira fundo branco no JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  for (const quality of [0.8, 0.65, 0.5]) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= MAX_ATTACHMENT_BYTES) return blob;
  }
  return null;
}

async function needsShrink(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) return true;
  try {
    const image = await decode(file);
    const big = Math.max(...sizeOf(image));
    image.close?.();
    return big > MAX_SIDE * 1.1;
  } catch {
    return false; // o servidor confere
  }
}

function baseName(name) {
  return (name || 'foto').replace(/\.[^.]{1,10}$/, '') || 'foto';
}

/**
 * Prepara o arquivo escolhido: `{ blob, name, type, isPhoto }`. Fotos grandes são
 * reduzidas; HEIC (iPhone) é convertido quando o navegador sabe abrir, senão pede JPG.
 * Lança AttachmentError com a mensagem para a pessoa.
 */
export async function prepareFile(file) {
  const type = await sniff(file);
  if (type === 'image/heic' || isHeic(file)) {
    const blob = await shrink(file).catch(() => null);
    if (!blob) throw new AttachmentError(t.attachment.heic);
    return { blob, name: `${baseName(file.name)}.jpg`, type: 'image/jpeg', isPhoto: true };
  }
  if (type === 'application/pdf') {
    if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentError(t.attachment.invalid);
    return { blob: file, name: file.name || 'documento.pdf', type, isPhoto: false };
  }
  if (!PHOTO_TYPES.includes(type)) throw new AttachmentError(t.attachment.invalid);
  if (await needsShrink(file)) {
    const blob = await shrink(file).catch(() => null);
    if (!blob) throw new AttachmentError(t.attachment.invalid);
    return { blob, name: `${baseName(file.name)}.jpg`, type: 'image/jpeg', isPhoto: true };
  }
  return { blob: file, name: file.name || 'foto', type, isPhoto: true };
}

/**
 * Envia o anexo (multipart) com progresso (0–1). Devolve `{ promise, abort }`; a promessa
 * resolve com o anexo salvo ou rejeita com ApiError (status 0 = rede; message 'abort' =
 * cancelado pela pessoa).
 */
export function uploadAttachment(activityId, prepared, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', `/api/activities/${activityId}/attachment`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.attachment);
      else reject(new ApiError(xhr.status, data?.error || t.attachment.uploadError, data));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.onabort = () => reject(new ApiError(0, 'abort'));
    const form = new FormData();
    form.append('file', prepared.blob, prepared.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Endereço do anexo (o `v` evita mostrar um arquivo antigo do cache após substituir). */
export function attachmentUrl(activityId, attachment, { download = false } = {}) {
  const params = new URLSearchParams({ v: String(attachment.id) });
  if (download) params.set('download', '1');
  return `/api/activities/${activityId}/attachment?${params}`;
}

export function isPhotoAttachment(attachment) {
  return Boolean(attachment?.mimeType?.startsWith('image/'));
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
