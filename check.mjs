// node check.mjs: validates theme.json and renders the original and the CSS sky in headless Chromium.
// Writes reference-WxH.png (the site's own renderTo, fit "cover", no shooting star) and
// compare-WxH.png (reference left, the shipped sky right). The pixel difference is measured on the sky
// at the site's own dot size and brightness (DOT_SCALE 1, SKY_TONE 1,1,1), so it still checks the port
// whatever the shipped tuning is. Exits 1 if a hard limit fails.
// Needs a Chromium binary: set CHROMIUM to its path if it is not /usr/bin/chromium.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { PANEL_MARK, SCRIM_ALPHA, SCRIM, SKY_TONE, FRAMES_T, dotModel, frameAt, skyCss } from "./build.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const PKG = path.join(HERE, "node_modules/ascii-magic-art/");
const SIZES = [[1920, 1080], [1280, 1416]];
const MAD_AIM = 4, MAX_CSS = 20000, MIN_CONTRAST = 4.5;
let failed = false;
const hard = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failed = true; };

// ---- theme.json --------------------------------------------------------------------------
let theme;
try { theme = JSON.parse(fs.readFileSync(HERE + "theme.json", "utf8")); console.log("PASS  theme.json parses"); }
catch (e) { console.log("FAIL  theme.json does not parse:", e.message); process.exit(1); }
const hex = /^#[0-9a-f]{6}$/i;
hard(theme.name === "Starry Ridge" && theme.appearance === "dark" && theme.version === 1 && hex.test(theme.canvas) && hex.test(theme.accent) &&
  typeof theme.colors === "object" && Object.values(theme.colors).every((v) => hex.test(v)) && typeof theme.css === "string",
  "theme object shape (name, appearance dark, version 1, hex canvas/accent/colors, css string)");
const css = theme.css, cut = css.indexOf(PANEL_MARK), sky = css.slice(0, cut);
console.log(`INFO  css length ${css.length} chars (limit ${MAX_CSS}): sky part ${sky.length}, panels ${css.length - sky.length}; ${Object.keys(theme.colors).length} colour roles`);
hard(css.length <= MAX_CSS, `css <= ${MAX_CSS}`);
hard(cut > 0, "sky part found ahead of the panels");
const bad = [];
if (/@import/i.test(css)) bad.push("@import");
if (/image-set\(/i.test(css)) bad.push("image-set(");
for (const m of css.matchAll(/url\(\s*(?!["']?(?:data:|#))([^)]{0,40})/gi)) bad.push(`url(${m[1]}`);
hard(!bad.length, `no forbidden pattern (@import, image-set(, url( other than data: or #)${bad.length ? ": " + bad.join(", ") : ""}`);
const motion = /@media \(prefers-reduced-motion:no-preference\)\{[^{}]*\{[^{}]*\}\}/g, moving = css.match(motion) ?? [];
hard(moving.some((b) => b.includes("animation:sr-star")) && !/animation:/.test(css.replace(motion, "")), `every animation sits inside prefers-reduced-motion:no-preference (${moving.length} blocks)`);

// ---- text contrast over the brightest sky -------------------------------------------------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const model = dotModel(frameAt(FRAMES_T));
const dots = model.rgb.filter(Boolean).map((c) => c.map((v, q) => Math.round(v * SKY_TONE[q])));
const brightest = dots.reduce((a, c) => (lum(c) > lum(a) ? c : a));
const scrimMatch = css.match(/--sr-scrim:rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/);
// only real backings count: glows and gradients also use rgb(.. / a) but are never behind text on their own
const sc = scrimMatch ? scrimMatch.slice(1, 4).map(Number) : SCRIM, alphas = [...css.matchAll(/background-color:rgb\(\d+ \d+ \d+ \/ ([\d.]+)\)/g)].map((m) => +m[1]);
const aMin = Math.min(...alphas, SCRIM_ALPHA);
const back = sc.map((v, i) => v * aMin + brightest[i] * (1 - aMin));
console.log(`INFO  brightest shipped sky dot rgb(${brightest}); weakest backing alpha ${aMin} over it = rgb(${back.map(Math.round)})`);
for (const role of ["text", "textMuted", "placeholder", "sidebarForeground", "messageForeground", "toolbarForeground"]) {
  if (!theme.colors[role]) continue;
  const r = ratio(rgbOf(theme.colors[role]), back);
  hard(r >= MIN_CONTRAST, `contrast ${role} ${theme.colors[role]} on backed brightest sky = ${r.toFixed(2)}:1 (>= ${MIN_CONTRAST})`);
}
for (const role of ["text", "sidebarForeground", "messageForeground", "toolbarForeground"]) { // main text must also survive with no backing at all
  if (!theme.colors[role]) continue;
  const r = ratio(rgbOf(theme.colors[role]), brightest);
  hard(r >= MIN_CONTRAST, `contrast ${role} ${theme.colors[role]} directly on the brightest sky dot = ${r.toFixed(2)}:1 (>= ${MIN_CONTRAST})`);
}
const faithful = skyCss(model, { dotScale: 1, tone: [1, 1, 1], rest: 1 });

// ---- pixel comparison in headless Chromium ---------------------------------------------------
const server = http.createServer((q, r) => {
  const f = path.join(PKG, decodeURIComponent(q.url.split("?")[0]).replace(/^\/pkg\//, ""));
  if (!f.startsWith(PKG) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/plain" }); r.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--force-device-scale-factor=1", "--hide-scrollbars"] });
try {
  for (const [w, h] of SIZES) {
    const rp = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await rp.goto(`http://127.0.0.1:${port}/pkg/README.md`);
    const ref = Buffer.from(await rp.evaluate(async ({ w, h, t }) => {
      const { renderTo } = await import("/pkg/runtime/canvas.js"), mod = await import("/pkg/pieces/starry-ridge.js");
      const c = document.createElement("canvas");
      renderTo(c, mod.default()(t), mod.meta.palette, { width: w, height: h, fit: "cover", meta: mod.meta, look: {} });
      return c.toDataURL("image/png").split(",")[1];
    }, { w, h, t: FRAMES_T }), "base64");
    await rp.close();
    fs.writeFileSync(`${HERE}reference-${w}x${h}.png`, ref);

    const shot = async (skyRules) => {
      const cp = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await cp.emulateMedia({ reducedMotion: "reduce" }); // still sky: also proves the reduced-motion rule
      await cp.setContent(`<!doctype html><meta charset=utf-8><style>${skyRules}</style><body></body>`);
      await cp.waitForTimeout(500);
      const png = await cp.screenshot({ type: "png" });
      await cp.close();
      return png.toString("base64");
    };
    const mine = await shot(faithful), shipped = await shot(sky);

    const mp = await browser.newPage({ viewport: { width: 400, height: 300 } });
    const out = await mp.evaluate(async ({ a, b, c, w, h }) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
      const px = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return [c, x.getImageData(0, 0, w, h).data]; };
      const [ia, ib, ic] = await Promise.all([load(a), load(b), load(c)]);
      const [, da] = px(ia), [, db] = px(ib), sum = [0, 0, 0];
      for (let i = 0; i < da.length; i += 4) for (let q = 0; q < 3; q++) sum[q] += Math.abs(da[i + q] - db[i + q]);
      const n = w * h, cc = document.createElement("canvas"); cc.width = 2 * w; cc.height = h;
      const x = cc.getContext("2d"); x.drawImage(ia, 0, 0); x.drawImage(ic, w, 0);
      return { mad: sum.map((s) => s / n), png: cc.toDataURL("image/png").split(",")[1] };
    }, { a: ref.toString("base64"), b: mine, c: shipped, w, h });
    await mp.close();
    fs.writeFileSync(`${HERE}compare-${w}x${h}.png`, Buffer.from(out.png, "base64"));
    const mean = out.mad.reduce((s, v) => s + v, 0) / 3;
    console.log(`${mean <= MAD_AIM ? "PASS" : "WARN"}  ${w}x${h}: port at the site's dot size and brightness, mean abs difference per channel R ${out.mad[0].toFixed(2)}  G ${out.mad[1].toFixed(2)}  B ${out.mad[2].toFixed(2)}  (mean ${mean.toFixed(2)}, aim <= ${MAD_AIM}; 0..255)`);
  }
} finally { await browser.close(); server.close(); }

console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
process.exit(failed ? 1 : 0);
