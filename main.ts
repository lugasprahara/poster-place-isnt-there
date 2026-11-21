// SOLMARA — "Where the Sun Sets Twice"
// A programmatic vintage-modern travel poster for a place that isn't there.
// Node stdlib only. Writes /output/entry.png (1024x1024, RGB PNG).
// Renders internally at 2048x2048 and box-downsamples 2x for antialiasing.

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { FONT } from "./font.ts";

// ---------- deterministic PRNG (mulberry32) ----------
let seedState = 123456789;
function srand(s) { seedState = s >>> 0; }
function rnd() {
  seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------- canvas ----------
const SS = 2;                 // supersample factor
const W = 1024, H = 1024;     // final size
const DW = W * SS, DH = H * SS;
const buf = new Uint8Array(DW * DH * 3);

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function setPx(x, y, col, alpha) {
  if (x < 0 || y < 0 || x >= DW || y >= DH) return;
  const i = (y * DW + x) * 3;
  if (alpha >= 1) {
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2];
  } else if (alpha > 0) {
    buf[i]     = buf[i]     + (col[0] - buf[i])     * alpha;
    buf[i + 1] = buf[i + 1] + (col[1] - buf[i + 1]) * alpha;
    buf[i + 2] = buf[i + 2] + (col[2] - buf[i + 2]) * alpha;
  }
}
function fillRect(x0, y0, x1, y1, col, alpha) {
  const ax = Math.max(0, Math.floor(x0 * SS)), bx = Math.min(DW, Math.ceil(x1 * SS));
  const ay = Math.max(0, Math.floor(y0 * SS)), by = Math.min(DH, Math.ceil(y1 * SS));
  for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) setPx(x, y, col, alpha);
}

// vertical gradient over a y band, stops = [[pos0..1, [r,g,b]], ...]
function vGrad(y0, y1, stops) {
  const ay = Math.floor(y0 * SS), by = Math.ceil(y1 * SS);
  for (let y = ay; y < by; y++) {
    const t = (y / SS - y0) / (y1 - y0);
    let col = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        col = mix(stops[s][1], stops[s + 1][1], (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]));
        break;
      }
    }
    for (let x = 0; x < DW; x++) setPx(x, y, col, 1);
  }
}

// scanline even-odd polygon fill; contours in 1024-space coords
function fillContours(contours, col, alpha) {
  // build edge list per scanline lazily: gather all points' y range
  let minY = Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const ay = Math.max(0, Math.floor(minY * SS)), by = Math.min(DH - 1, Math.ceil(maxY * SS));
  for (let y = ay; y <= by; y++) {
    const yc = (y + 0.5) / SS;
    const xs = [];
    for (const c of contours) {
      for (let i = 0; i < c.length; i++) {
        const p1 = c[i], p2 = c[(i + 1) % c.length];
        if ((p1[1] <= yc && p2[1] > yc) || (p2[1] <= yc && p1[1] > yc)) {
          xs.push(p1[0] + (yc - p1[1]) / (p2[1] - p1[1]) * (p2[0] - p1[0]));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.floor(xs[k] * SS), x1 = Math.ceil(xs[k + 1] * SS);
      for (let x = Math.max(0, x0); x < Math.min(DW, x1); x++) setPx(x, y, col, alpha);
    }
  }
}
function fillPoly(points, col, alpha) { fillContours([points], col, alpha === undefined ? 1 : alpha); }

function fillCircle(cx, cy, r, col, alpha) {
  const ay = Math.max(0, Math.floor((cy - r) * SS)), by = Math.min(DH - 1, Math.ceil((cy + r) * SS));
  for (let y = ay; y <= by; y++) {
    const dy = (y + 0.5) / SS - cy;
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    const x0 = Math.floor((cx - hw) * SS), x1 = Math.ceil((cx + hw) * SS);
    for (let x = Math.max(0, x0); x < Math.min(DW, x1); x++) setPx(x, y, col, alpha);
  }
}
function fillEllipse(cx, cy, rx, ry, col, alpha) {
  const ay = Math.max(0, Math.floor((cy - ry) * SS)), by = Math.min(DH - 1, Math.ceil((cy + ry) * SS));
  for (let y = ay; y <= by; y++) {
    const dy = ((y + 0.5) / SS - cy) / ry;
    const hw = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    const x0 = Math.floor((cx - hw) * SS), x1 = Math.ceil((cx + hw) * SS);
    for (let x = Math.max(0, x0); x < Math.min(DW, x1); x++) setPx(x, y, col, alpha);
  }
}
// sun disc: vertical gradient core(top) -> edge(bottom), clipped to y <= clipY
function sunDisc(cx, cy, r, topCol, botCol, clipY) {
  const ay = Math.max(0, Math.floor((cy - r) * SS)), by = Math.min(DH - 1, Math.ceil(Math.min(cy + r, clipY) * SS));
  for (let y = ay; y <= by; y++) {
    const yc = (y + 0.5) / SS;
    const dy = yc - cy;
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    const t = (yc - (cy - r)) / (2 * r);
    const col = mix(topCol, botCol, Math.pow(t, 1.3));
    const x0 = Math.floor((cx - hw) * SS), x1 = Math.ceil((cx + hw) * SS);
    for (let x = Math.max(0, x0); x < Math.min(DW, x1); x++) setPx(x, y, col, 1);
  }
}
function stampLine(points, r, col, alpha) {
  for (const p of points) fillCircle(p[0], p[1], r, col, alpha);
}

// ---------- palette ----------
const SKY = ["#2E1A47", "#7A2E5A", "#C94F4F", "#E8834F", "#F7B267"].map(hex);
const SEA_H = hex("#20506B"), SEA_D = hex("#0B2436");
const SUN_CORE = hex("#FFE3A3"), SUN_EDGE = hex("#F7B267");
const SIL = hex("#1D1030"), TOWER = hex("#2A1745");
const CREAM = hex("#FFF3D6"), LAMP = hex("#FFE9BE"), TAG = hex("#FFE9BE");
const FRAME = hex("#F6E7C8"), APRICOT = hex("#F7B267");
const FAR_RIDGE = hex("#4A2358");

// ---------- sky, sun (sea painted after, so glow/disc clip at horizon) ----------
vGrad(0, 640, [[0, SKY[0]], [0.34, SKY[1]], [0.58, SKY[2]], [0.8, SKY[3]], [1, SKY[4]]]);

// stars in the top plum band
srand(42);
for (let i = 0; i < 90; i++) {
  const x = 40 + rnd() * 944, y = 40 + Math.pow(rnd(), 1.6) * 215;
  const a = 0.16 + rnd() * 0.4 * (1 - y / 300);
  if (a > 0.03) fillCircle(x, y, 0.9 + rnd() * 1.1, CREAM, a);
}

// sun: soft warm halo (radial falloff, apricot over orange), then disc.
// Painted before sea + ridges, so the glow is clipped by their silhouettes
// and only blooms into the sky; inner rings accumulate for a bright core.
{
  const HALO_OUT = hex("#E8834F"), HALO_IN = hex("#F7B267");
  for (let r = 432; r > 190; r -= 5) {
    const t = (r - 190) / (432 - 190);          // 1 at outer edge -> 0 at disc
    const a = 0.010 + 0.025 * Math.pow(1 - t, 2);
    fillCircle(512, 640, r, mix(HALO_OUT, HALO_IN, 1 - t), a);
  }
  // warm cream lift right around the dome so it reads as a glowing sun
  for (let r = 252; r > 190; r -= 5) {
    fillCircle(512, 640, r, SUN_CORE, 0.028);
  }
}
sunDisc(512, 640, 190, SUN_CORE, hex("#F59E4C"), 1024);

// ---------- sea ----------
vGrad(640, 1024, [[0, SEA_H], [0.25, mix(SEA_H, SEA_D, 0.45)], [1, SEA_D]]);

// soft warm glow patch on the water directly under the sun: many feathered
// ellipses (no hard edge), painted before the ridges so their silhouettes
// clip its top and it only ever lights the water
for (let s = 1; s > 0.12; s -= 0.055) {
  fillEllipse(512, 714, 180 * s, 60 * s, s > 0.55 ? APRICOT : SUN_CORE, 0.020);
}

// ---------- ridges (the first sunset) ----------
// far ridge: gentle band, top edge ~y 566-600
{
  const pts = [];
  for (let x = 0; x <= 1024; x += 16) pts.push([x, 578 + 14 * Math.sin(x * 0.009 + 0.8) + 7 * Math.sin(x * 0.021 + 2.1)]);
  pts.push([1024, 648], [0, 648]);
  fillPoly(pts, FAR_RIDGE, 0.92);
}
// near ridge: dark silhouette crossing the sun, top edge ~y 596-628
{
  const pts = [];
  for (let x = 0; x <= 1024; x += 12) pts.push([x, 610 + 13 * Math.sin(x * 0.012 + 1.9) + 6 * Math.sin(x * 0.03 + 0.4)]);
  for (let x = 1024; x >= 0; x -= 12) pts.push([x, 664 + 5 * Math.sin(x * 0.017 + 0.9)]);
  fillPoly(pts, SIL, 1);
}

// ---------- sea reflection (the second sunset) ----------
// warm column wash, stronger than before so the streaks sit on lit water
fillPoly([[512 - 120, 668], [512 + 120, 668], [512 + 185, 985], [512 - 185, 985]], SUN_EDGE, 0.10);
fillPoly([[512 - 82, 668], [512 + 82, 668], [512 + 128, 985], [512 - 128, 985]], SUN_EDGE, 0.11);
srand(777);
{
  let y = 678;
  while (y < 972) {
    const t = (y - 668) / 310;
    const wHalf = (142 * (1 - t * 0.32)) * (0.45 + rnd() * 0.6);
    const cxOff = (rnd() - 0.5) * 26 * (1 + t);
    // warm tones only: apricot, sun cream, and lamp cream for the brightest hits
    const pick = rnd();
    const col = pick > 0.62 ? APRICOT : pick > 0.22 ? SUN_CORE : LAMP;
    // strong just under the horizon, fading downward
    const a = 0.72 * (1 - t * 0.62) + 0.06;
    const h = 3.2 + rnd() * 3.4;
    // broken streak: 2-4 segments with gaps, so it shimmers instead of striping
    let sx = 512 + cxOff - wHalf;
    const xEnd = 512 + cxOff + wHalf;
    while (sx < xEnd) {
      const seg = (0.25 + rnd() * 0.5) * wHalf;
      fillRect(sx, y, Math.min(xEnd, sx + seg), y + h, col, a * (0.75 + rnd() * 0.35));
      sx += seg + 4 + rnd() * 16;
    }
    // bright narrow core streak down the centre of the column (most rows,
    // skipped at random so the core shimmers instead of striping)
    if (rnd() > 0.35) {
      const cw = wHalf * (0.20 + rnd() * 0.18);
      fillRect(512 + cxOff * 0.5 - cw, y, 512 + cxOff * 0.5 + cw, y + h, LAMP, a * 0.38);
    }
    y += h + 5 + rnd() * 9;
  }
  // sparkle flecks away from the column: kept, but much subtler so the open
  // sea reads calm instead of noisy
  for (let i = 0; i < 55; i++) {
    const x = 60 + rnd() * 904, yy = 672 + Math.pow(rnd(), 1.3) * 300;
    if (Math.abs(x - 512) < 120) continue;
    fillRect(x, yy, x + 3 + rnd() * 7, yy + 1.4, APRICOT, 0.03 + rnd() * 0.035);
  }
}

// ---------- lighthouse point (right) ----------
// light beam first (behind tower, over sky): a slim, soft cone up-left
fillPoly([[874, 452], [300, 300], [344, 252], [884, 434]], LAMP, 0.07);
fillPoly([[876, 450], [336, 292], [366, 262], [883, 436]], LAMP, 0.06);
// rocks
fillPoly([[726, 700], [762, 648], [822, 626], [884, 640], [936, 618], [984, 652], [1002, 700], [992, 756], [906, 784], [796, 778], [724, 748]], SIL, 1);
fillPoly([[700, 742], [760, 706], [838, 716], [872, 748], [850, 786], [716, 784]], SIL, 1);
// tower: tapered, base y 668 -> gallery y 492
fillPoly([[846, 668], [856, 492], [908, 492], [918, 668]], TOWER, 1);
// cream bands on the tower
fillPoly([[849.5, 622], [914.5, 622], [912.5, 600], [851.5, 600]], CREAM, 0.92);
fillPoly([[853, 560], [911, 560], [909.5, 540], [854.5, 540]], CREAM, 0.92);
// lamp halo first (behind the housing, so it glows into the sky and never
// washes the housing brown), then gallery + lamp room + cap in deep plum
fillCircle(882, 457, 54, APRICOT, 0.07);
fillCircle(882, 457, 42, APRICOT, 0.09);
fillCircle(882, 457, 31, SUN_CORE, 0.10);
// gallery + lamp room + cap: housing in the tower's deep plum family
fillRect(842, 478, 922, 494, SIL, 1);
fillRect(856, 436, 908, 478, TOWER, 1);
// lamp glass: bright warm cream, with a small brighter core
fillRect(866, 444, 898, 470, LAMP, 1);
fillRect(874, 450, 890, 464, hex("#FFF6DC"), 0.85);
fillPoly([[850, 436], [914, 436], [882, 404]], SIL, 1);
fillRect(878, 392, 886, 406, SIL, 1);
// lit window slits on tower
fillRect(876, 576, 888, 592, LAMP, 0.95);
fillRect(877, 512, 887, 526, LAMP, 0.8);

// ---------- birds ----------
function gull(cx, cy, s) {
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14, a = Math.PI * (1 - t); pts.push([cx - s + Math.cos(a) * s * 0.52 + s * 0.0, cy - Math.sin(a) * s * 0.34]); }
  // simpler: two arcs meeting at center
  const left = [], right = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; left.push([cx - t * s, cy - Math.sin(t * Math.PI * 0.72) * s * 0.42 + t * s * 0.16]); }
  for (let i = 0; i <= 12; i++) { const t = i / 12; right.push([cx + t * s, cy - Math.sin(t * Math.PI * 0.72) * s * 0.42 + t * s * 0.16]); }
  stampLine(left, 2.1, SIL, 0.9);
  stampLine(right, 2.1, SIL, 0.9);
}
gull(212, 118, 17); gull(302, 84, 12); gull(716, 92, 15); gull(812, 138, 11); gull(140, 168, 10);

// ---------- text ----------
function textContours(text, fontSize, tracking) {
  const scale = fontSize / FONT.unitsPerEm;
  const glyphs = [];
  let total = 0;
  for (const ch of text) {
    const g = FONT.glyphs[ch];
    if (!g) continue;
    glyphs.push([ch, g, total]);
    total += g.advance * scale + tracking;
  }
  total -= text.length ? tracking : 0;
  return { glyphs, scale, total };
}
function drawText(text, cx, baseline, fontSize, tracking, col, alpha) {
  const { scale, total } = textContours(text, fontSize, tracking);
  void scale;
  let x = cx - total / 2;
  for (const ch of text) {
    const g = FONT.glyphs[ch];
    if (!g) continue;
    if (g.contours.length) {
      const contours = g.contours.map(c => c.map(p => [x + p[0] * scale, baseline - p[1] * scale]));
      fillContours(contours, col, alpha);
    }
    x += g.advance * scale + tracking;
  }
  return total;
}
// auto-fit: shrink the point size until the line fits maxW
function fitSize(text, fontSize, tracking, maxW) {
  let fs = fontSize;
  while (fs > 10 && textContours(text, fs, tracking).total > maxW) fs -= 2;
  return fs;
}
const NAME_FS = fitSize("SOLMARA", 196, 6, 896);
const TAG_FS = fitSize("WHERE THE SUN SETS TWICE", 40, 9, 864);
// soft shadow pass, then the name, then tagline
drawText("SOLMARA", 514, 303, NAME_FS, 6, hex("#2A1030"), 0.38);
drawText("SOLMARA", 512, 300, NAME_FS, 6, CREAM, 1);
drawText("WHERE THE SUN SETS TWICE", 512, 374, TAG_FS, 9, TAG, 0.97);
// thin rule under tagline
fillRect(512 - 150, 392, 512 + 150, 394.5, TAG, 0.55);

// ---------- frame ----------
fillRect(0, 0, 1024, 26, FRAME, 1); fillRect(0, 998, 1024, 1024, FRAME, 1);
fillRect(0, 0, 26, 1024, FRAME, 1); fillRect(998, 0, 1024, 1024, FRAME, 1);
// keyline just inside the frame
const KEY = hex("#7A2E5A");
fillRect(36, 36, 988, 38.5, KEY, 0.85); fillRect(36, 985.5, 988, 988, KEY, 0.85);
fillRect(36, 36, 38.5, 988, KEY, 0.85); fillRect(985.5, 36, 988, 988, KEY, 0.85);

// ---------- downsample 2x ----------
const out = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const oi = (y * W + x) * 3;
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const ii = ((y * SS + dy) * DW + (x * SS + dx)) * 3;
      r += buf[ii]; g += buf[ii + 1]; b += buf[ii + 2];
    }
    out[oi] = r / 4; out[oi + 1] = g / 4; out[oi + 2] = b / 4;
  }
}
// vignette + posterize + grain (deterministic)
srand(20261121);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const dx = (x - 512) / 512, dy = (y - 512) / 512;
    const d2 = dx * dx + dy * dy;
    const vig = 1 - 0.16 * Math.max(0, d2 - 0.55);
    const gr = (rnd() - 0.5) * 3;
    for (let c = 0; c < 3; c++) {
      let v = out[i + c] * vig + gr;
      v = Math.round(v / 4) * 4;               // gentle posterize for a lean file
      out[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

// ---------- PNG encode (CRC32 + adaptive filters + deflate 9) ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function filteredScanlines(rgb, w, h) {
  const bpp = 3, stride = w * bpp;
  const rows = [];
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let best = null, bestScore = Infinity, bestType = 0;
    for (let f = 0; f <= 4; f++) {
      const cand = Buffer.alloc(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let pred = 0;
        if (f === 1) pred = a; else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1; else if (f === 4) pred = paeth(a, b, c);
        const v = (row[i] - pred) & 0xFF;
        cand[i] = v;
        score += Math.abs(v < 128 ? v : v - 256);
      }
      if (score < bestScore) { bestScore = score; best = cand; bestType = f; }
    }
    rows.push(Buffer.from([bestType]), best);
    prev = row;
  }
  return Buffer.concat(rows);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const idat = deflateSync(filteredScanlines(out, W, H), { level: 9 });
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync("/output", { recursive: true });
writeFileSync("/output/entry.png", png);
console.log("wrote /output/entry.png", png.length, "bytes");
