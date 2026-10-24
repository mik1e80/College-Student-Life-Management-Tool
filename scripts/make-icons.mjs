// Dependency-free app icon generator: geometric artwork, RGBA PNG encoding.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
function crc32(buf) { let c = 0xffffffff; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
for (const size of [192, 512]) {
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x * 192 / size, py = y * 192 / size;
    let c = [40, 91, 69, 255];
    if (px >= 49 && px <= 140 && py >= 57 && py <= 145) c = [248, 243, 230, 255];
    if (px >= 66 && px <= 74 && py >= 57 && py <= 145) c = [40, 91, 69, 255];
    if ((py >= 80 && py <= 88 && px >= 87 && px <= 119) || (py >= 99 && py <= 107 && px >= 87 && px <= 109)) c = [40, 91, 69, 255];
    if ((px - 136) ** 2 + (py - 57) ** 2 <= 23 ** 2) c = [216, 233, 166, 255];
    if ((px >= 123 && px <= 134 && Math.abs(py - (px - 68)) <= 3) || (px >= 132 && px <= 149 && Math.abs(py - (199 - px)) <= 3)) c = [40, 91, 69, 255];
    const offset = y * (size * 4 + 1) + 1 + x * 4; data.set(c, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  writeFileSync(`dist/icon-${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]));
}
