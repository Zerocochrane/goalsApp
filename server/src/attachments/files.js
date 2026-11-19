// Conteúdo dos anexos: tipo pelo conteúdo (assinatura / magic bytes, nunca pela extensão),
// remoção de metadados das fotos (EXIF/GPS, XMP, comentários) e dimensões.
//
// Tudo em JavaScript puro, sem dependência nativa: os formatos aceitos (JPEG, PNG, WebP)
// guardam os metadados em blocos próprios, que são simplesmente descartados — a imagem
// não é decodificada nem recomprimida.

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export const ATTACHMENT_TYPES = {
  'image/jpeg': { ext: 'jpg', image: true },
  'image/png': { ext: 'png', image: true },
  'image/webp': { ext: 'webp', image: true },
  'application/pdf': { ext: 'pdf', image: false },
};

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/**
 * Tipo do arquivo pelo conteúdo: um dos ATTACHMENT_TYPES, 'image/heic' (foto do iPhone
 * que não foi convertida) ou null.
 */
export function detectType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 4, 8) === 'ftyp' &&
    HEIF_BRANDS.has(buf.toString('latin1', 8, 12))
  ) {
    return 'image/heic';
  }
  return null;
}

class InvalidImageError extends Error {}

function need(cond) {
  if (!cond) throw new InvalidImageError('imagem inválida');
}

// ---------------------------------------------------------------------------------- JPEG

/** Orientação (1–8) gravada no EXIF (bloco APP1 "Exif\0\0"), ou null. */
function exifOrientation(data) {
  if (data.length < 14 || data.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const tiff = data.subarray(6);
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : null;
      }
    }
  } catch {
    // EXIF truncado: sem orientação
  }
  return null;
}

/** Bloco APP1 com um EXIF mínimo: só a orientação (nada de GPS, data, aparelho…). */
function orientationSegment(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 logo depois do cabeçalho
  tiff.writeUInt16BE(1, 8); // 1 entrada
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // 1 valor
  tiff.writeUInt16BE(orientation, 18);
  // 20–21: preenchimento; 22–25: próximo IFD = 0
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function stripJpeg(buf) {
  const kept = []; // segmentos mantidos (com marcador)
  let orientation = null;
  let width = null;
  let height = null;
  let pos = 2;
  let tail = null;

  while (pos < buf.length) {
    need(buf[pos] === 0xff);
    let marker = buf[pos + 1];
    // Bytes de preenchimento (0xFF repetidos) entre segmentos
    while (marker === 0xff) {
      pos++;
      marker = buf[pos + 1];
    }
    need(marker !== undefined);
    // Marcadores sem tamanho
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (marker === 0xd9) {
      tail = buf.subarray(pos);
      break;
    }
    need(pos + 4 <= buf.length);
    const len = buf.readUInt16BE(pos + 2);
    need(len >= 2 && pos + 2 + len <= buf.length);
    const segment = buf.subarray(pos, pos + 2 + len);
    const data = buf.subarray(pos + 4, pos + 2 + len);

    if (marker === 0xda) {
      // Início da imagem comprimida: daqui até o fim não há mais metadados
      tail = buf.subarray(pos);
      break;
    }
    // SOF0–SOF15 (exceto DHT, JPG e DAC): dimensões
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      need(data.length >= 5);
      height = data.readUInt16BE(1);
      width = data.readUInt16BE(3);
    }

    const isApp = marker >= 0xe0 && marker <= 0xef;
    let keep = true;
    if (marker === 0xfe)
      keep = false; // comentário
    else if (marker === 0xe1) {
      orientation ??= exifOrientation(data); // EXIF/XMP: descarta, guarda só a orientação
      keep = false;
    } else if (isApp) {
      const id = data.toString('latin1', 0, 12);
      // Mantém JFIF (APP0), perfil de cor (APP2 ICC_PROFILE) e Adobe (APP14, cores);
      // o resto (IPTC/Photoshop, fabricante…) sai
      keep =
        (marker === 0xe0 && id.startsWith('JFIF')) ||
        (marker === 0xe2 && id.startsWith('ICC_PROFILE')) ||
        (marker === 0xee && id.startsWith('Adobe'));
    }
    if (keep) kept.push(segment);
    pos += 2 + len;
  }
  need(tail && width && height);

  const parts = [buf.subarray(0, 2)];
  // EXIF mínimo logo depois do JFIF (ou do início), para a foto não "deitar"
  const jfifFirst = kept[0]?.[1] === 0xe0;
  if (jfifFirst) parts.push(kept.shift());
  if (orientation && orientation !== 1) parts.push(orientationSegment(orientation));
  parts.push(...kept, tail);

  // Orientações 5–8 giram 90°: a foto aparece com largura e altura trocadas
  const rotated = orientation >= 5;
  return {
    buffer: Buffer.concat(parts),
    width: rotated ? height : width,
    height: rotated ? width : height,
  };
}

// ----------------------------------------------------------------------------------- PNG

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(buf) {
  const parts = [buf.subarray(0, 8)];
  let pos = 8;
  let width = null;
  let height = null;
  let ended = false;
  while (pos < buf.length) {
    need(pos + 12 <= buf.length);
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    need(end <= buf.length);
    if (type === 'IHDR') {
      need(len >= 8);
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  need(ended && width && height);
  return { buffer: Buffer.concat(parts), width, height };
}

// ---------------------------------------------------------------------------------- WebP

function stripWebp(buf) {
  const chunks = [];
  let pos = 12;
  let width = null;
  let height = null;
  const riffEnd = Math.min(buf.length, buf.readUInt32LE(4) + 8);
  while (pos + 8 <= riffEnd) {
    const type = buf.toString('latin1', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + len + (len % 2);
    need(pos + 8 + len <= buf.length);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'VP8X') {
      need(len >= 10);
      width = data.readUIntLE(4, 3) + 1;
      height = data.readUIntLE(7, 3) + 1;
    } else if (type === 'VP8 ' && width === null) {
      need(len >= 10);
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && width === null) {
      need(len >= 5 && data[0] === 0x2f);
      const bits = data.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    if (type !== 'EXIF' && type !== 'XMP ') {
      let chunk = Buffer.from(buf.subarray(pos, Math.min(end, buf.length)));
      if (chunk.length % 2) chunk = Buffer.concat([chunk, Buffer.alloc(1)]);
      // VP8X: desliga os indicadores de EXIF (0x08) e XMP (0x04)
      if (type === 'VP8X') chunk[8] &= ~0x0c;
      chunks.push(chunk);
    }
    pos = end;
  }
  need(width && height);
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { buffer: Buffer.concat([header, body]), width, height };
}

/**
 * Prepara o arquivo enviado para ser salvo. Devolve
 * `{ mimeType, buffer, width, height }` (fotos sem metadados) ou `{ error }`:
 * - 'heic': foto HEIC do iPhone (pedir JPG)
 * - 'type': tipo não aceito ou arquivo corrompido
 */
export function prepareAttachment(input) {
  const mimeType = detectType(input);
  if (mimeType === 'image/heic') return { error: 'heic' };
  if (!mimeType) return { error: 'type' };
  if (mimeType === 'application/pdf') {
    return { mimeType, buffer: input, width: null, height: null };
  }
  try {
    const strip =
      mimeType === 'image/jpeg' ? stripJpeg : mimeType === 'image/png' ? stripPng : stripWebp;
    return { mimeType, ...strip(input) };
  } catch (err) {
    if (err instanceof InvalidImageError || err instanceof RangeError) return { error: 'type' };
    throw err;
  }
}
