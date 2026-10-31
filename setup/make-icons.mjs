// Draws the PNG app icons (a white "H" on the accent blue). Run: node setup/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
// scale: size of the H relative to the icon (smaller for maskable so it stays in the safe zone)
function icon(size, scale) {
  const bg = [0x3f, 0x5f, 0x86], fg = [255, 255, 255], SS = 4;
  const half = 0.5 * scale, stroke = 0.17 * scale;
  const inBar = (x, y, x0, y0, x1, y1) => {           // rounded line segment (capsule)
    const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= stroke / 2;
  };
  const L = 0.5 - half * 0.75, R = 0.5 + half * 0.75, T = 0.5 - half * 0.9, B = 0.5 + half * 0.9;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + .5) / SS) / size, v = (y + (sy + .5) / SS) / size;
        if (inBar(u, v, L, T, L, B) || inBar(u, v, R, T, R, B) || inBar(u, v, L, .5, R, .5)) hits++;
      }
      const a = hits / (SS * SS), o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(bg[i] * (1 - a) + fg[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dir = new URL("../icons/", import.meta.url);
writeFileSync(new URL("icon-192.png", dir), icon(192, 0.62));
writeFileSync(new URL("icon-512.png", dir), icon(512, 0.62));
writeFileSync(new URL("icon-maskable-512.png", dir), icon(512, 0.46));
writeFileSync(new URL("apple-touch-icon.png", dir), icon(180, 0.62));
console.log("icons written");
