/*
 * Generates the Cockpit app icon.
 *
 *   node scripts/make-icon.mjs
 *
 * Writes build/icon.png (1024px, the master electron-builder derives .ico and
 * .icns from) and src/app/favicon.ico (a real multi-size icon for the web app).
 *
 * Everything is drawn procedurally with zlib and maths. sharp is present as a
 * Next.js dependency but its install script never ran, and pulling an image
 * toolchain in just to draw two circles and a line isn't worth the dependency.
 *
 * The subject is an attitude indicator: the one cockpit instrument everybody
 * recognises, and one of the few that survives being shrunk to 16px, where it
 * degrades to a violet half-disc rather than to mud.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Palette lifted from src/app/globals.css so the icon and the app agree.
// The card tones are nudged lighter than --color-base: an icon sitting on a
// dark dock or a dark repo page needs to be a shape, not a black square.
const CARD_TOP = [0x1e, 0x22, 0x2c];
const CARD_BOTTOM = [0x0e, 0x10, 0x15];
const BEZEL = [0x3d, 0x44, 0x52];
const ACCENT = [0x7c, 0x5c, 0xff];
const ACCENT_HOT = [0x9b, 0x86, 0xff];
const GROUND_TOP = [0x2f, 0x35, 0x42];
const GROUND_BOTTOM = [0x1c, 0x20, 0x29];
const INK = [0xe9, 0xeb, 0xef];

const SS = 4; // Supersampling factor per axis; 16 samples a pixel.

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Signed distance to a rounded rectangle centred on the canvas. */
function sdRoundRect(x, y, halfW, halfH, r) {
  const qx = Math.abs(x) - halfW + r;
  const qy = Math.abs(y) - halfH + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Colour of one sample point, in coordinates normalised to -0.5..0.5.
 * Returns [r, g, b, a] with a in 0..1.
 */
function sample(x, y) {
  // Card. Inset slightly so the corners aren't clipped by platform masking.
  if (sdRoundRect(x, y, 0.46, 0.46, 0.105) > 0) return [0, 0, 0, 0];

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // Vertical sheen across the card, lighter at the top.
  let rgb = mix(CARD_TOP, CARD_BOTTOM, clamp01(y + 0.5));

  const dist = Math.hypot(x, y);
  const FACE = 0.355;
  const RIM = 0.385;

  if (dist <= RIM) {
    if (dist > FACE) {
      // Bezel, brightest along the top edge so it reads as a lit rim.
      rgb = mix(BEZEL, CARD_BOTTOM, clamp01(y + 0.7));
    } else {
      /*
       * The horizon is banked. Level, this is just a two-tone circle; the tilt
       * is what makes it read as an instrument rather than a pie chart.
       *
       * `h` is signed distance from the horizon line: negative is sky. The
       * constant offset drops the horizon below centre, i.e. a nose-up
       * attitude, which keeps the fixed aircraft marker clear of the horizon
       * line instead of tangled in it.
       */
      const tilt = (-11 * Math.PI) / 180;
      const h = x * Math.sin(tilt) + y * Math.cos(tilt) - 0.085;

      if (h < 0) {
        rgb = mix(ACCENT_HOT, ACCENT, clamp01((y + FACE) / (FACE * 1.6)));
      } else {
        rgb = mix(GROUND_TOP, GROUND_BOTTOM, clamp01(h / FACE));
      }

      // Pitch ladder: two rungs either side of the horizon. They vanish into
      // the disc at favicon sizes, which is the intent — detail for the large
      // renders, no clutter in the small ones.
      const rung = (offset, halfLen) =>
        Math.abs(h - offset) <= 0.007 &&
        Math.abs(x * Math.cos(tilt) - y * Math.sin(tilt)) <= halfLen;
      if (rung(-0.21, 0.075)) rgb = mix(rgb, INK, 0.5);
      if (rung(0.14, 0.075)) rgb = mix(rgb, INK, 0.4);

      // The horizon itself, bright, so the split reads as a drawn line.
      if (Math.abs(h) <= 0.009) rgb = INK;

      // Aircraft marker: wing bars and a centre pip, always level regardless
      // of bank. This is the fixed reference the horizon moves against.
      const onBar =
        Math.abs(y) <= 0.016 && Math.abs(x) >= 0.05 && Math.abs(x) <= 0.16;
      const onPip = dist <= 0.026;
      if (onBar || onPip) rgb = INK;
    }
  }

  return [...rgb, 1];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (pxi * SS + sx + 0.5) * step - 0.5;
          const ny = (py * SS + sy + 0.5) * step - 0.5;
          const [sr, sg, sb, sa] = sample(nx, ny);
          r += sr * sa; g += sg * sa; b += sb * sa; a += sa;
        }
      }
      const n = SS * SS;
      const o = (py * size + pxi) * 4;
      // Un-premultiply so edge pixels keep their colour instead of darkening.
      px[o] = a > 0 ? Math.round(r / a) : 0;
      px[o + 1] = a > 0 ? Math.round(g / a) : 0;
      px[o + 2] = a > 0 ? Math.round(b / a) : 0;
      px[o + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour with alpha
  // Filter byte 0 per scanline: the shapes are smooth, so deflate does fine
  // without per-line filter selection.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO ------------------------------------------------------------------

/** PNG-compressed ICO entries. Understood by every browser and by Windows. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  for (const [i, img] of images.entries()) {
    const o = i * 16;
    dir[o] = img.size >= 256 ? 0 : img.size; // 0 means 256
    dir[o + 1] = img.size >= 256 ? 0 : img.size;
    dir.writeUInt16LE(1, o + 4);   // colour planes
    dir.writeUInt16LE(32, o + 6);  // bits per pixel
    dir.writeUInt32LE(img.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.png.length;
  }
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

// --- Output ---------------------------------------------------------------

mkdirSync(join(ROOT, 'build'), { recursive: true });

const master = encodePng(1024, render(1024));
writeFileSync(join(ROOT, 'build', 'icon.png'), master);
console.log(`build/icon.png            1024px  ${(master.length / 1024).toFixed(1)} KB`);

const ico = encodeIco(
  [16, 32, 48, 128, 256].map((size) => ({ size, png: encodePng(size, render(size)) }))
);
writeFileSync(join(ROOT, 'src', 'app', 'favicon.ico'), ico);
console.log(`src/app/favicon.ico       16-256  ${(ico.length / 1024).toFixed(1)} KB`);
