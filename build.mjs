// Regenerates theme.json from the ascii-magic-art@1.1.0 "starry-ridge" piece.
//   node build.mjs
// The sky is one SVG (data: URI) drawn as a CSS background: the piece's exact
// dot grid (252 x 141 dots, round, 4 sizes) as vector strokes, masked per size by a
// tiny level-map PNG, coloured by a small smooth colour-map PNG.
import fs from "node:fs";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import create, { meta } from "ascii-magic-art/pieces/starry-ridge.js";

const HERE = new URL(".", import.meta.url).pathname;
const pkg = JSON.parse(fs.readFileSync(new URL("./node_modules/ascii-magic-art/package.json", import.meta.url), "utf8"));
if (pkg.version !== "1.1.0") throw new Error(`ascii-magic-art@1.1.0 required, found ${pkg.version}`);

// ---- tuning -------------------------------------------------------------------------
export const COL_W = 36;          // colour map width in pixels (height follows the 16:9 art)
export const COL_K = 24;          // colours in the colour map's palette
export const HI_LEVELS = [2, 3];  // dot sizes that take their colour from the exact per-dot map
export const HI_K = 24;           // palette size of that map
export const NUDGE = 0.042;       // cells; the site's PNG export draws every dot 0.5 px up-left
export const DOT_SCALE = 0.65;    // dot diameter relative to the original piece (1 = the site's size)
export const SKY_TONE = [0.55, 0.4, 0.55]; // R, G, B multipliers on every dot colour (1,1,1 = the site's brightness); less green keeps the dimmed glow pink, not grey
export const SCRIM = [9, 9, 11];  // the sky's own canvas black (#09090b); backing colour behind text
export const SCRIM_ALPHA = 0.9;   // reading lane behind the conversation
export const PANEL_ALPHA = 0.94;  // sidebar, header, composer
export const FRAMES_T = 1;        // a frame with no shooting star (visible only for t % 9 < 0.81)

// ---- the piece's own dot model (port of runtime/canvas.js paintTone, dots look) ----------
const LV = { "▁": 0.135, "▂": 0.257, "▃": 0.378, "▄": 0.51, "▅": 0.635, "▆": 0.757, "▇": 0.878, "█": 1 };
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const SIZES = [0.2, 0.5, 0.85, 1.32];
const DENSITY = 1.31, SIZE = 0.51 / 0.85, TONE = { lo: 0.04, hi: 0.985, curve: 1.1, sat: meta.dots.tone.sat };
const brighten = (h, k) => {
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), mx = Math.max(...v, 1), f = (255 / mx) * k + (1 - k);
  return v.map((c) => Math.round(Math.min(255, c * f)));
};
const lumHex = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

export const frameAt = (t) => create()(t);
export function dotModel(frame) {
  const T = frame.text.split("\n").map((r) => [...r]), C = frame.color.split("\n").map((r) => [...r]);
  const rows = T.length, cols = T[0].length, vals = new Float32Array(rows * cols), keys = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, k = C[r][c], hx = k !== " " ? meta.palette[k] : null;
    if (T[r][c] === " ") { vals[i] = -1; continue; }
    vals[i] = LV[T[r][c]] * (hx ? lumHex(hx) : 0.88); keys[i] = hx;
  }
  let vmax = 0, n = 0; for (const v of vals) if (v > vmax) vmax = v;
  const HB = 512, hist = new Uint32Array(HB);
  for (const v of vals) if (v >= 0) { hist[Math.min(HB - 1, Math.floor((v / (vmax || 1)) * HB))]++; n++; }
  const P = (q) => { let acc = 0; for (let k = 0; k < HB; k++) { acc += hist[k]; if (acc >= q * n) return ((k + 0.5) / HB) * vmax; } return vmax; };
  const a = P(TONE.lo), b = Math.max(P(TONE.hi), a + 1e-4);
  const gx = Math.round(cols * DENSITY), gy = Math.round(rows * DENSITY), sx = cols / gx, sy = rows / gy;
  const lvl = new Int8Array(gx * gy).fill(-1), rgb = new Array(gx * gy).fill(null);
  const v0 = (i) => (vals[i] < 0 ? 0 : vals[i]);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const fx = (i + 0.5) * sx - 0.5, fy = (j + 0.5) * sy - 0.5;
    const c0 = Math.min(cols - 1, Math.max(0, Math.floor(fx))), r0 = Math.min(rows - 1, Math.max(0, Math.floor(fy)));
    const c1 = Math.min(cols - 1, c0 + 1), r1 = Math.min(rows - 1, r0 + 1), tx = Math.min(1, Math.max(0, fx - c0)), ty = Math.min(1, Math.max(0, fy - r0));
    const val = v0(r0 * cols + c0) * (1 - tx) * (1 - ty) + v0(r0 * cols + c1) * tx * (1 - ty) + v0(r1 * cols + c0) * (1 - tx) * ty + v0(r1 * cols + c1) * tx * ty;
    const ni = Math.min(rows - 1, Math.round(fy)) * cols + Math.min(cols - 1, Math.round(fx));
    const hx = keys[ni] || keys[r0 * cols + c0];
    if ((vals[ni] < 0 && vals[r0 * cols + c0] < 0) || !hx) continue;
    const t = Math.pow(Math.min(1, Math.max(0, (val - a) / (b - a))), TONE.curve);
    let l = Math.floor(t * 4 - 0.5); const frac = t * 4 - 0.5 - l;
    if (frac > (B4[(j & 3) * 4 + (i & 3)] + 0.5) / 16) l++;
    if (l < 0) continue;
    lvl[j * gx + i] = Math.min(3, l); rgb[j * gx + i] = brighten(hx, TONE.sat);
  }
  return { gx, gy, sx, sy, lvl, rgb };
}

// ---- PNG encoder (gray / RGB, adaptive per-row filters) -----------------------------------
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
function png(w, h, data, ch, plte = null, trns = null) {
  // data: bytes, ch bytes per pixel; plte: [[r,g,b]...] makes it an indexed image (ch=1, index per byte)
  const bd = !plte ? 8 : plte.length <= 2 ? 1 : plte.length <= 4 ? 2 : plte.length <= 16 ? 4 : 8;
  const rb = Math.ceil((w * ch * bd) / 8), bp = Math.max(1, (ch * bd) >> 3);
  const rows = Array.from({ length: h }, (_, y) => {
    if (bd === 8) return Buffer.from(data.subarray(y * rb, (y + 1) * rb));
    const r = Buffer.alloc(rb); for (let x = 0; x < w; x++) r[(x * bd) >> 3] |= data[y * w + x] << (8 - bd - ((x * bd) & 7)); return r;
  });
  const filt = (r, p, f) => { const o = Buffer.alloc(rb + 1); o[0] = f; for (let x = 0; x < rb; x++) {
    const a = x >= bp ? r[x - bp] : 0, b = p[x], c = x >= bp ? p[x - bp] : 0; let pr = 0;
    if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
    else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
    o[1 + x] = (r[x] - pr) & 255; } return o; };
  const zero = Buffer.alloc(rb), sc = (o) => { let s = 0; for (let i = 1; i < o.length; i++) s += o[i] < 128 ? o[i] : 256 - o[i]; return s; };
  const variants = [0, 1, 2, 3, 4].map((f) => Buffer.concat(rows.map((r, y) => filt(r, y ? rows[y - 1] : zero, f))));
  variants.push(Buffer.concat(rows.map((r, y) => { let best = null; for (const f of [0, 1, 2, 3, 4]) { const o = filt(r, y ? rows[y - 1] : zero, f); const s = sc(o); if (!best || s < best.s) best = { s, o }; } return best.o; })));
  let best = null;
  for (const v of variants) for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
    const z = zlib.deflateSync(v, { level: 9, memLevel: 9, strategy }); if (!best || z.length < best.length) best = z;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bd; ihdr[9] = plte ? 3 : ch === 1 ? 0 : ch === 2 ? 4 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...(plte ? [chunk("PLTE", Buffer.from(plte.flat()))] : []), ...(trns ? [chunk("tRNS", Buffer.from(trns))] : []), chunk("IDAT", best), chunk("IEND", Buffer.alloc(0))]);
}

// ---- the sky ---------------------------------------------------------------------------
const f4 = (x) => +x.toFixed(4), f6 = (x) => +x.toFixed(6);
const enc = (s) => s.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/"/g, "'");
const dataUri = (svg) => `url("data:image/svg+xml,${enc(svg)}")`;

function levelPng(m) { // 5-state indexed image: black, with the alpha of each state = its bin centre; the sky reads the alpha
  const idx = new Uint8Array(m.lvl.length).map((_, k) => m.lvl[k] + 1);
  return png(m.gx, m.gy, idx, 1, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [0, 1, 2, 3, 4].map((s) => Math.round(((s + 0.5) / 5) * 255)));
}

// deterministic k-means (farthest-first start) over weighted RGB points
function kmeans(pts, wts, K) {
  const cs = [pts[wts.indexOf(Math.max(...wts))].slice()];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (cs.length < K) { let bi = 0, bd = -1; pts.forEach((p, i) => { const d = Math.min(...cs.map((c) => d2(p, c))) * wts[i]; if (d > bd) { bd = d; bi = i; } }); cs.push(pts[bi].slice()); }
  for (let it = 0; it < 30; it++) {
    const acc = cs.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { let bi = 0, bd = 1e18; cs.forEach((c, k) => { const d = d2(p, c); if (d < bd) { bd = d; bi = k; } }); for (let q = 0; q < 3; q++) acc[bi][q] += p[q] * wts[i]; acc[bi][3] += wts[i]; });
    acc.forEach((a, k) => { if (a[3]) for (let q = 0; q < 3; q++) cs[k][q] = a[q] / a[3]; });
  }
  return cs.map((c) => c.map((v) => Math.round(v)));
}
const toner = (tone) => (c) => c.map((v, q) => Math.round(v * tone[q]));
function colourPng(m, w, K, tone) { // smooth colour map: area-weighted mean colour of the lit dots in each block, K-colour indexed PNG
  const h = Math.round((w * 108) / 192), px = new Array(w * h), wt = new Array(w * h).fill(0), seen = new Uint8Array(w * h);
  const area = (k) => (m.lvl[k] < 0 ? 0 : Math.PI * (0.5 * SIZE * SIZES[m.lvl[k]]) ** 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j0 = Math.floor((y * m.gy) / h), j1 = Math.max(j0 + 1, Math.floor(((y + 1) * m.gy) / h));
    const i0 = Math.floor((x * m.gx) / w), i1 = Math.max(i0 + 1, Math.floor(((x + 1) * m.gx) / w));
    const s = [0, 0, 0]; let n = 0;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const k = j * m.gx + i, a = area(k); if (a) { n += a; for (let q = 0; q < 3; q++) s[q] += m.rgb[k][q] * a; } }
    if (n) { px[y * w + x] = s.map((v) => v / n); wt[y * w + x] = n; seen[y * w + x] = 1; }
  }
  for (let pass = 0; pass < w + h; pass++) { // blocks with no lit dot are masked out anyway: fill them from neighbours so they cost nothing
    let any = false; const fill = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!seen[y * w + x]) {
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < w && b < h && seen[b * w + a]);
      if (nb.length) fill.push([y * w + x, [0, 1, 2].map((q) => nb.reduce((s, [a, b]) => s + px[b * w + a][q], 0) / nb.length)]);
    }
    for (const [i, c] of fill) { px[i] = c; seen[i] = 1; any = true; }
    if (!any) break;
  }
  const real = px.map((_, i) => i).filter((i) => wt[i] > 0), pal = kmeans(real.map((i) => px[i]), real.map((i) => wt[i]), K);
  const idx = new Uint8Array(w * h);
  px.forEach((p, i) => { let bi = 0, bd = 1e18; pal.forEach((c, k) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = k; } }); idx[i] = bi; });
  return png(w, h, idx, 1, pal.map(toner(tone)));
}

function colourPngHi(m, levels, K, tone, dim) { // exact per-dot colours for the big dots (stars, glow), one pixel per dot; the rest copies its left neighbour so it costs ~nothing
  // dim(k): brightness multiplier for dot k, below 1 for the stars that sparkle so they rest darker than they flare
  const idx = new Uint8Array(m.lvl.length), pts = [], wts = [], col = (k) => m.rgb[k].map((v) => v * dim(k));
  for (let k = 0; k < m.lvl.length; k++) if (levels.includes(m.lvl[k])) { pts.push(col(k)); wts.push((0.5 * SIZE * SIZES[m.lvl[k]]) ** 2); }
  const pal = kmeans(pts, wts, K);
  for (let k = 0; k < idx.length; k++) {
    if (!levels.includes(m.lvl[k])) { idx[k] = k % m.gx ? idx[k - 1] : k >= m.gx ? idx[k - m.gx] : 0; continue; }
    const p = col(k); let bi = 0, bd = 1e18;
    pal.forEach((c, q) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = q; } });
    idx[k] = bi;
  }
  return png(m.gx, m.gy, idx, 1, pal.map(toner(tone)));
}

export function skySvg(m, dotScale = DOT_SCALE, tone = SKY_TONE, rest = TWINKLE.rest) {
  const { sx, sy } = m, b64 = (b) => b.toString("base64"), stars = new Set(rest === 1 ? [] : starIslands(m).flat());
  const img = (id, p, extra = "") => `<image id='${id}' width='192' height='108' preserveAspectRatio='none' href='data:image/png;base64,${b64(p)}'${extra}/>`;
  // dot grid: one row = zero-length dashes with round caps; rows by binary doubling (141 = 128+8+4+1)
  let defs = img("L", levelPng(m), " style='image-rendering:pixelated'") + img("C", colourPng(m, COL_W, COL_K, tone)) +
    img("H", colourPngHi(m, HI_LEVELS, HI_K, tone, (k) => (stars.has(k) ? rest : 1)), " style='image-rendering:pixelated'");
  defs += `<path id='r0' d='M${f6(sx / 2)} ${f6(sy / 2)}h191.5'/>`;
  for (let i = 1; i < 8; i++) defs += `<g id='r${i}'><use href='#r${i - 1}'/><use href='#r${i - 1}' y='${f6(sy * 2 ** (i - 1))}'/></g>`;
  const parts = [[7, 0], [3, 128], [2, 136], [0, 140]];
  defs += `<g id='G' fill='none' stroke='#fff' stroke-linecap='round' stroke-dasharray='0 ${f6(sx)}'>` +
    parts.map(([i, r]) => `<use href='#r${i}'${r ? ` y='${f6(sy * r)}'` : ""}/>`).join("") + `</g>`;
  let body = "";
  for (let n = 0; n < 4; n++) {
    const tv = [0, 1, 2, 3, 4].map((s) => (s === n + 1 ? 1 : 0)).join(" "), r = f4(0.5 * SIZE * SIZES[n]);
    defs += `<filter id='f${n}' x='0' y='0' width='1' height='1'><feComponentTransfer><feFuncA type='discrete' tableValues='${tv}'/></feComponentTransfer></filter>` +
      `<mask id='l${n}' maskUnits='userSpaceOnUse' x='0' y='0' width='192' height='108' style='mask-type:alpha'><use href='#L' filter='url(#f${n})'/></mask>` +
      `<mask id='d${n}'><use href='#G' stroke-width='${f4(2 * r * dotScale)}' mask='url(#l${n})'/></mask>`;
    body += `<use href='#${HI_LEVELS.includes(n) ? "H" : "C"}' mask='url(#d${n})'/>`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${NUDGE} ${NUDGE} 192 108'><defs>${defs}</defs><rect width='192' height='108' fill='#09090b'/>${body}</svg>`;
}

// ---- the shooting star -------------------------------------------------------------------
// lib/image.js: every 9 s, for the first 9 % (13 frames at 15 fps), 14 cells along (0.5 W, 0.18 H)
// from (W * x0, 0.12 H); x0 steps 0.25, 0.45, 0.65, 0.85, 1.05 (off screen) every period.
// The sprite is what that does to the dot grid in one mid-flight frame, relative to the head.
function starSprite() {
  const FR = 6, K = FR / 12.15, base = dotModel(frameAt(FRAMES_T)), mid = dotModel(frameAt(FR / 15));
  const hx = 48 + K * 96, hy = 12.96 + K * 19.44, pts = [[], [], [], []];
  for (let k = 0; k < base.lvl.length; k++) {
    if (mid.lvl[k] < 0 || mid.lvl[k] === base.lvl[k]) continue;
    pts[mid.lvl[k]].push([(k % base.gx + 0.5) * base.sx - hx, (((k / base.gx) | 0) + 0.5) * base.sy - hy]);
  }
  return pts;
}
const trim = (x) => String(+x.toFixed(2)).replace(/^(-?)0\./, "$1.");
function starSvg(dotScale, tone) {
  const pts = starSprite(), all = pts.flat(), PAD = 1;
  const x0 = Math.floor(Math.min(...all.map((p) => p[0]))) - PAD, y0 = Math.floor(Math.min(...all.map((p) => p[1]))) - PAD;
  const w = Math.ceil(Math.max(...all.map((p) => p[0]))) + PAD - x0, h = Math.ceil(Math.max(...all.map((p) => p[1]))) + PAD - y0;
  const cream = "#" + toner(tone)(brighten(meta.palette["0"], TONE.sat)).map((v) => v.toString(16).padStart(2, "0")).join("");
  let sh = "";
  pts.forEach((list, n) => {
    if (!list.length) return;
    list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let px = 0, py = 0, d = "";
    for (const [x, y] of list) { d += `m${trim(x - px)} ${trim(y - py)}h0`; px = x; py = y; }
    sh += `<path stroke-width='${f4(SIZE * SIZES[n] * dotScale)}' d='M0 0${d}'/>`;
  });
  // every path starts at the head (0,0) with a zero-length move, so the relative chain begins there
  return { svg: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${x0} ${y0} ${w} ${h}' fill='none' stroke='${cream}' stroke-linecap='round'>${sh}</svg>`, x0, y0, w, h };
}

// ---- sparkling stars -----------------------------------------------------------------------
// A star is a small island of big dots (levels 2-3, at least one level 3) in the dark sky. The horizon glow is one
// huge island and is left out. The stars are dealt into groups; each group is one full-window layer that stays dark,
// then flares twice per cycle. Every group has its own cycle length and offset, so the flares never line up and read
// as single stars sparkling at random. A layer holds the stars' own dots in a brighter colour; CSS adds the halo.
// peak/echo = a layer's opacity at the big and the small flare; cycles = seconds per group;
// rest = brightness of a sparkling star between flares, relative to the rest of the sky (1 = the piece's own).
export const TWINKLE = { maxIsland: 16, peak: 0.18, echo: 0.09, rest: 0.55, colour: "#fde", cycles: [7, 9.5, 11, 13, 8.2] };
// Layers behind the app. html and body pseudo-elements always exist; the other two hang off the app's outermost
// layout box, the one stable full-window element the theme can reach.
const TWINKLE_BOX = `:is(html,[data-slot="sidebar-wrapper"])`;
const TWINKLE_LAYERS = ["html::before", "body::before", "html::after", `[data-slot="sidebar-wrapper"]::before`, `[data-slot="sidebar-wrapper"]::after`];
export function starIslands(m) {
  const { gx, gy, lvl } = m, seen = new Uint8Array(gx * gy), out = [];
  for (let k = 0; k < gx * gy; k++) {
    if (seen[k] || lvl[k] < 2) continue;
    const stack = [k], island = []; seen[k] = 1;
    while (stack.length) {
      const q = stack.pop(), x = q % gx, y = (q / gx) | 0; island.push(q);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, n = Y * gx + X;
        if (X >= 0 && Y >= 0 && X < gx && Y < gy && !seen[n] && lvl[n] >= 2) { seen[n] = 1; stack.push(n); }
      }
    }
    if (island.length <= TWINKLE.maxIsland && island.some((q) => lvl[q] === 3)) out.push(island);
  }
  return out;
}
// Deal the stars into n groups that flare together. Stars are taken in a seeded random order and each goes to the
// group whose nearest member is farthest away (groups kept the same size), so a group is scattered across the whole
// sky instead of clumped, and which stars share a group has no visible pattern.
export function starGroups(m, n) {
  let seed = 0x5eed;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const stars = starIslands(m).map((island) => ({ island, x: island.reduce((s, q) => s + (q % m.gx), 0) / island.length, y: island.reduce((s, q) => s + ((q / m.gx) | 0), 0) / island.length }));
  for (let i = stars.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [stars[i], stars[j]] = [stars[j], stars[i]]; }
  const groups = Array.from({ length: n }, () => []), cap = Math.ceil(stars.length / n);
  for (const s of stars) {
    let best = null, bestGap = -1;
    for (const g of groups) {
      if (g.length >= cap) continue;
      const gap = g.length ? Math.min(...g.map((o) => Math.hypot(o.x - s.x, o.y - s.y))) : Infinity;
      if (gap > bestGap) { bestGap = gap; best = g; }
    }
    best.push(s);
  }
  return groups.map((g) => g.map((s) => s.island));
}
function twinkleSvg(m, islands, dotScale) {
  // drawn in grid units: the viewBox maps cell (i, j) onto its dot centre in the 192 x 108 picture
  const { gx, gy, sx, sy } = m, w = (n) => trim((SIZE * SIZES[n] * dotScale) / sx);
  const dots = (level) => {
    let px = 0, py = 0, d = "";
    for (const q of islands.flat().filter((k) => m.lvl[k] === level).sort((a, b) => a - b)) {
      const x = q % gx, y = (q / gx) | 0; d += `${d ? "m" : "M"}${x - px} ${y - py}z`; px = x; py = y; // a closed zero-length subpath: a round dot
    }
    return d && `<path stroke-width='${w(level)}' d='${d}'/>`;
  };
  // no fill attribute: a zero-length subpath has no area to fill
  return `<svg xmlns='http://www.w3.org/2000/svg' width='192' height='108' viewBox='${trim(NUDGE / sx - 0.5)} ${trim(NUDGE / sy - 0.5)} ${gx} ${gy}' preserveAspectRatio='none' stroke='${TWINKLE.colour}' stroke-linecap='round'>${dots(3)}${dots(2)}</svg>`;
}

export function skyCss(m, { dotScale = DOT_SCALE, tone = SKY_TONE, rest = TWINKLE.rest } = {}) {
  const star = starSvg(dotScale, tone), groups = starGroups(m, TWINKLE_LAYERS.length);
  const layers = `${TWINKLE_BOX}::before,${TWINKLE_BOX}::after,body::before`, halo = (r) => `drop-shadow(0 0 calc(${r}*var(--cw)) ${TWINKLE.colour})`;
  const slots = [48, 86.4, 124.8, 163.2], T = 45, WIN = (13 / 15 / T) * 100, END = 12 / 12.15;
  const pt = (x, y) => `--x:${f4(x)};--y:${f4(y)}`;
  let kf = "";
  slots.forEach((x, s) => {
    const p0 = s * 20, p1 = p0 + WIN;
    kf += (s ? `${f4(p0 - 0.01)}%{opacity:0}` : "") + `${f4(p0)}%{opacity:1;${pt(x, 12.96)};animation-timing-function:steps(13,jump-none)}` +
      `${f4(p1)}%{opacity:1;${pt(x + 96 * END, 12.96 + 19.44 * END)}}${f4(p1 + 0.01)}%{opacity:0}`;
  });
  const sky =
    `@property --x{syntax:"<number>";inherits:false;initial-value:0}@property --y{syntax:"<number>";inherits:false;initial-value:0}` +
    `:root{--cw:max(100vw/192,100vh/108)}` +
    `html{background:#09090b ${dataUri(skySvg(m, dotScale, tone, rest))} 50% 100%/cover no-repeat fixed!important}` +
    `body{background:none!important}` +
    `${layers},body::after{content:"";position:fixed;z-index:-1;pointer-events:none;opacity:0}` +
    // The mask is a grid of soft discs that lets through only some of a group's stars. sr-pick slides it one notch
    // every half cycle, always while the group is dark, so each flare shows a different handful of that group.
    `${layers}{inset:0;background-position:50% 100%;background-size:cover;background-repeat:no-repeat;filter:${halo(0.4)} ${halo(1.1)};mask:radial-gradient(closest-side,#000 60%,#0000 90%) 0 0/9vw 13vh}` +
    TWINKLE_LAYERS.map((sel, g) => `${sel}{background-image:${dataUri(twinkleSvg(m, groups[g], dotScale))};--sd:${TWINKLE.cycles[g]}s;--so:-${trim(g * 2.7)}s}`).join("") +
    `body::after{left:calc(50vw - 96*var(--cw));top:calc(100vh - 108*var(--cw));margin:calc(${star.y0}*var(--cw)) 0 0 calc(${star.x0}*var(--cw));width:calc(${star.w}*var(--cw));height:calc(${star.h}*var(--cw));opacity:0;` +
    `transform:translate(calc(var(--x)*var(--cw)),calc(var(--y)*var(--cw)));background:${dataUri(star.svg)} 0 0/100% 100% no-repeat}` +
    `@media (prefers-reduced-motion:no-preference){body::after{animation:sr-star ${T}s linear infinite}}` +
    `@media (prefers-reduced-motion:no-preference){${layers}{animation:sr-twinkle var(--sd) var(--so) infinite,sr-pick calc(5*var(--sd)) var(--so) steps(10) infinite}}` +
    `@keyframes sr-twinkle{0%,22%,52%,66%,100%{opacity:0}9%{opacity:${TWINKLE.peak}}58%{opacity:${TWINKLE.echo}}}` +
    `@keyframes sr-pick{to{mask-position:33.3vw 29.9vh}}` + // 3.7 x 2.3 mask tiles over 10 notches: ten different selections before it repeats
    `@keyframes sr-star{${kf}100%{opacity:0}}`;
  return sky;
}

// ---- panels ("Afterglow"): the sidebar, header, composer and every conversation row float as dark rounded cards over the one sky ----
export const PANEL_MARK = ":root{--sr-scrim:"; // everything before this in `css` is the sky
export const scrim = (a) => `rgb(${SCRIM.join(" ")} / ${a})`;
const GLOW = "248 107 216"; // palette "a", the horizon pink
function panelCss() {
  const S = scrim(SCRIM_ALPHA), S2 = scrim(PANEL_ALPHA), edge = "#26262c", lift = "0 10px 28px -6px rgb(0 0 0 / .7)";
  // A sidebar thread whose work waits on you (unread result, request, woke). The app marks these rows only by class: every
  // read, idle row is muted, and bg-transparent / bg-warning/4 are what the unread and woke rows get instead.
  const waiting = `[data-thread-item]:has([data-sidebar-row]:is(.bg-transparent,.bg-warning\\/4))`, violet = "150 80 220";
  return `${PANEL_MARK}${S};--sr-horizon:linear-gradient(90deg,transparent,#8c309b 14%,#f86bd8 38%,#ffedce 54%,#f86bd8 70%,#8c309b 88%,transparent)}` +
    `[data-slot="sidebar-wrapper"],[data-slot="sidebar"],[data-slot="sidebar-inset"],div:has(>[data-chat-column]),[data-chat-column],[data-workspace-area="conversation"],.messages-timeline-scroll,[data-timeline-loading]{background:transparent!important}` +
    // sidebar and header: floating cards
    `[data-slot="sidebar-container"]{padding:.5rem 0 .5rem .5rem;border:0!important}` +
    `[data-slot="sidebar-inner"]{background-color:${S2}!important;border:1px solid ${edge};border-radius:.875rem;box-shadow:${lift};overflow:hidden}` +
    `[data-thread-item] [aria-current]{background:linear-gradient(90deg,rgb(${GLOW} / .26),rgb(${GLOW} / .05))!important}` +
    // the app gives each row paint containment (content-visibility:auto), which would clip a glow around it
    `${waiting}{content-visibility:visible;position:relative}` +
    // waiting rows breathe: a static glow on a pseudo-element whose opacity is animated, so nothing repaints
    `${waiting}::after{content:"";position:absolute;inset:2px 0;border-radius:.375rem;pointer-events:none;opacity:.6;box-shadow:0 0 12px -2px rgb(${violet} / .6),inset 0 0 12px -5px rgb(${violet} / .7)}` +
    `@media (prefers-reduced-motion:no-preference){${waiting}::after{animation:sr-breathe 4.5s ease-in-out infinite alternate}}` +
    `@keyframes sr-breathe{from{opacity:.2}to{opacity:1}}` +
    `[data-chat-header]{background-color:${S2}!important;margin:.5rem .75rem 0;border:1px solid ${edge};border-radius:.875rem}` +
    // every conversation row is its own card; the transparent block border is the gap between cards (a margin would escape the
    // list's row measurement). The app's per-row bottom padding is replaced so each card is padded evenly.
    `[data-timeline-root]{background-color:var(--sr-scrim);background-clip:padding-box;border-block:.2rem solid transparent;border-radius:1rem;padding:.35rem .85rem}` +
    `[data-timeline-root]:has([data-message-role]){padding-block:.65rem}` + // messages get more room than work rows, so long tool runs stay compact
    `[data-timeline-row-kind]{padding-block:0!important}` +
    `[data-timeline-root]:has([data-timeline-row-kind]:empty){padding:0;border:0}` +
    // your own messages float on the sky with the glow under them
    `[data-timeline-root]:has([data-message-role="user"]){background:none;padding-inline:0}` +
    `[data-user-message-bubble]{border-radius:1rem 1rem .55rem 1rem;box-shadow:0 10px 22px -8px rgb(${GLOW} / .45)}` +
    `[data-settings-page-scroll]{background-color:var(--sr-scrim)}` +
    `.chat-markdown-codeblock{position:relative;border-radius:.65rem}` +
    `.chat-markdown-codeblock::before{content:"";position:absolute;inset:0 0 auto;height:1px;z-index:2;pointer-events:none;background:var(--sr-horizon)}` +
    // composer: lifted off the black so the input is easy to find, with the horizon glow under it
    `[data-slot="composer-host"]{background-color:rgb(28 28 34 / ${PANEL_ALPHA})!important;box-shadow:0 16px 30px -12px rgb(${GLOW} / .45),${lift}!important}` +
    // send button: matte flat plum (the messageAction role) while there is nothing to send; lit once there is: gradient, top glare, outer glow, glowing white arrow
    `.bg-message-action:not(:disabled){background-image:linear-gradient(#a8309f,#741f86);color:#fff;box-shadow:inset 0 1px 0 rgb(255 255 255 / .22),0 0 9px -2px rgb(195 80 190 / .38)}` +
    `.bg-message-action:not(:disabled) svg{filter:drop-shadow(0 0 2px rgb(255 237 206 / .5))}` +
    `::selection{background:rgb(${GLOW} / .4);color:#fff}` +
    `::-webkit-scrollbar-thumb{border-radius:99px;background-color:#4b4b55}`;
}

// ---- theme ----------------------------------------------------------------------------
export function buildTheme() {
  const m = dotModel(frameAt(FRAMES_T));
  const sky = skyCss(m), panels = panelCss(), css = sky + panels;
  if (!css.startsWith(sky) || css.indexOf(PANEL_MARK) !== sky.length) throw new Error("panel marker misplaced");
  // surfaces are near-black neutrals stepped up from the canvas, so panels match the sky's black; the piece's palette colours text and accent only
  const p = meta.palette, ink = { base: "#09090b", low: "#16161b", mid: "#202026", high: "#2e2e36", line: "#4b4b55", code: "#1b1b21" };
  const theme = {
    name: "Starry Ridge", appearance: "dark", version: 1,
    canvas: "#09090b", accent: p.a,
    colors: {
      chrome: ink.base, toolbar: ink.low, toolbarForeground: p["0"], toolbarBorder: ink.line,
      surface: ink.low, surfaceRaised: ink.high, surfaceOverlay: ink.mid, text: p["0"], textMuted: p["4"],
      border: ink.line, input: ink.mid, focus: p["5"], accent: p.a, accentForeground: "#09090b", placeholder: p["9"],
      sidebar: ink.base, sidebarForeground: p["0"], messageSurface: ink.high, messageForeground: p["0"],
      codeBackground: ink.code, codeForeground: p["0"],
      messageAction: "#872690", messageActionForeground: p["0"], messageActionHover: "#a8309f",
    },
    css,
  };
  return { theme, skyLen: sky.length, m };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { theme, skyLen } = buildTheme();
  fs.writeFileSync(HERE + "theme.json", JSON.stringify(theme, null, 2) + "\n");
  console.log(`theme.json written: css ${theme.css.length} chars, sky part ${skyLen} chars`);
}
