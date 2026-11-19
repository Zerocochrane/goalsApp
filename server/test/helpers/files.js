// Arquivos de teste montados byte a byte (fotos com metadados, PDF, "falsos").
import zlib from 'node:zlib';

function segment(marker, payload) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** EXIF com orientação e um IFD de GPS (latitude) — o que não pode sobrar no arquivo. */
function exifPayload(orientation) {
  const tiff = Buffer.alloc(80);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8); // 2 entradas
  tiff.writeUInt16LE(0x0112, 10); // Orientation
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0x8825, 22); // GPS IFD
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(40, 30);
  tiff.write('GPSLatitude-21.7642S;Longitude-43.3496W', 40, 'latin1');
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
}

export function makeJpeg({ width = 400, height = 300, orientation = 6, size } = {}) {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  const parts = [
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, exifPayload(orientation)),
    segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Câmera Pixel</x:xmpmeta>')),
    segment(0xfe, Buffer.from('comentário secreto')),
    segment(0xc0, sof),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
  ];
  const head = Buffer.concat(parts);
  const tailLen = size ? size - head.length - 2 : 64;
  return Buffer.concat([head, Buffer.alloc(tailLen, 0x55), Buffer.from([0xff, 0xd9])]);
}

function crc(buf) {
  return zlib.crc32(buf) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

/** PNG de verdade (abre no navegador), com texto e EXIF que devem ser removidos. */
export function makePng({ width = 40, height = 30, rgb = [220, 60, 60] } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Author\0Fulano GPS', 'latin1')),
    pngChunk('eXIf', exifPayload(1).subarray(6)),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function riffChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** WebP (VP8X + VP8L) com chunks EXIF e XMP. */
export function makeWebp({ width = 64, height = 48 } = {}) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c; // EXIF + XMP
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const vp8l = Buffer.alloc(9);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  const body = Buffer.concat([
    Buffer.from('WEBP', 'latin1'),
    riffChunk('VP8X', vp8x),
    riffChunk('VP8L', vp8l),
    riffChunk('EXIF', exifPayload(1).subarray(6)),
    riffChunk('XMP ', Buffer.from('<x:xmpmeta>GPS</x:xmpmeta>')),
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** PDF mínimo de uma página (abre no PDF.js). `size` completa com um comentário. */
export function makePdf({ size, text = 'Treino de pernas' } = {}) {
  const stream = `BT /F1 24 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  let buf = Buffer.from(pdf, 'latin1');
  if (size) {
    const pad = size - buf.length;
    buf = Buffer.concat([buf, Buffer.from(`%${'x'.repeat(pad - 2)}\n`, 'latin1')]);
  }
  return buf;
}

/** Cabeçalho de um HEIC do iPhone (só o suficiente para ser reconhecido). */
export function makeHeic() {
  const box = Buffer.alloc(32);
  box.writeUInt32BE(24, 0);
  box.write('ftypheic', 4, 'latin1');
  return box;
}
