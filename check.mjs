// node check.mjs: validates theme.json and renders the original and the CSS sky in headless Chromium.
// Writes reference-WxH.png (the site's own renderTo, fit "cover", no shooting star) and
// compare-WxH.png (reference left, the shipped sky right). The pixel difference is measured on the sky
// at the site's own dot size and brightness (DOT_SCALE 1, SKY_TONE 1,1,1), so it still checks the port
// whatever the shipped tuning is.
// It also checks the cue that a result is waiting: on a copy of T3 Code's sidebar markup, an unread row must glow
// and a read row must not. And when it can find T3 Code, it checks that the parts of the app the theme hooks into
// are still there. Exits 1 if a hard limit fails.
// Needs a Chromium binary: set CHROMIUM to its path if it is not /usr/bin/chromium.
// To check an installed T3 Code, set T3_APP_ASAR to its app.asar (on Linux a running AppImage is found on its own).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { PANEL_MARK, SCRIM_ALPHA, SCRIM, SKY_TONE, FRAMES_T, dotModel, frameAt, skyCss } from "./build.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const PKG = path.join(HERE, "node_modules/ascii-magic-art/");
const SIZES = [[1920, 1080], [1280, 1416]];
const MAD_AIM = 4, MAX_CSS = 20000, MIN_CONTRAST = 4.5;
const MIN_CUE = 6; // how much brighter the 5 px outside an unread row's list item must be than outside a read one's (0..255, mean)
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

  // ---- the cue that a result is waiting: an unread sidebar row glows, a read one does not ------------------------
  // These rows copy T3 Code's sidebar markup (0.1.10-nightly.20261114). The app marks an unread or woken thread only
  // by class, and gives every row paint containment, which clips a glow unless the theme lifts it. So this catches a
  // theme change that drops the glow or lets it be clipped. It cannot see T3 Code change; the hook scan below does that.
  const rowBase = "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none";
  const rows = {
    unread: ["bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover", ""],
    woke: ["bg-warning/4 hover:bg-warning/8 text-sidebar-foreground", ""],
    read: ["text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground", ""],
    selected: ["bg-sidebar-row-active text-sidebar-foreground", ` aria-current="page"`],
  };
  const fixture = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#09090b;color:#ffedce;font:13px/1.4 sans-serif}ul{margin:0;padding:20px;width:260px}` +
    `li{list-style:none;padding:2px 0;margin-bottom:20px;content-visibility:auto;contain-intrinsic-size:auto 78px}li>div{position:relative;width:100%;box-sizing:border-box;overflow:hidden;border-radius:6px;padding:8px 10px}` +
    `${css.slice(cut)}</style><ul>${Object.entries(rows).map(([name, [cls, attr]]) => `<li data-thread-item="${name}"><div role="treeitem" data-sidebar-row="${name}"${attr} class="${rowBase} ${cls}">${name}<br>thread title</div></li>`).join("")}</ul>`;
  const cue = async (reducedMotion) => {
    const fp = await browser.newPage({ viewport: { width: 300, height: 420 }, deviceScaleFactor: 1 });
    await fp.emulateMedia({ reducedMotion });
    await fp.setContent(fixture);
    await fp.waitForTimeout(200);
    await fp.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = a.effect.getComputedTiming().duration; })); // the breath at its brightest
    await fp.waitForTimeout(100);
    const b64 = (await fp.screenshot({ type: "png" })).toString("base64");
    const out = await fp.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data, res = {};
      for (const li of document.querySelectorAll("[data-thread-item]")) {
        const a = getComputedStyle(li, "::after"), r = li.getBoundingClientRect(); let sum = 0, n = 0;
        // the band: every pixel within 5 px outside the list item. Outside, because that is what containment clips.
        for (let py = Math.floor(r.top) - 5; py < Math.ceil(r.bottom) + 5; py++) for (let px = Math.floor(r.left) - 5; px < Math.ceil(r.right) + 5; px++) {
          if (px >= r.left && px < r.right && py >= r.top && py < r.bottom) continue;
          const o = (py * c.width + px) * 4; sum += Math.max(d[o] - 9, d[o + 1] - 9, d[o + 2] - 11, 0); n++;
        }
        res[li.dataset.threadItem] = { drawn: a.content !== "none" && a.boxShadow !== "none", anim: a.animationName, band: sum / n };
      }
      return res;
    }, b64);
    await fp.close();
    return out;
  };
  const moving = await cue("no-preference"), still = await cue("reduce"), f1 = (v) => v.toFixed(1);
  hard(moving.unread.drawn && moving.woke.drawn && moving.unread.anim === "sr-breathe" && moving.woke.anim === "sr-breathe", "unread and woken sidebar rows get the breathing glow");
  hard(!moving.read.drawn && !moving.selected.drawn, "read and selected sidebar rows get no glow");
  hard(moving.unread.band - moving.read.band >= MIN_CUE && moving.woke.band - moving.read.band >= MIN_CUE,
    `the glow shows on screen: brightness around the row is unread ${f1(moving.unread.band)}, woken ${f1(moving.woke.band)}, read ${f1(moving.read.band)} (unread and woken at least ${MIN_CUE} above read)`);
  hard(still.unread.drawn && still.unread.anim === "none" && still.unread.band - still.read.band >= MIN_CUE / 2,
    `with reduced motion the glow stays, still: unread ${f1(still.unread.band)}, read ${f1(still.read.band)}`);
} finally { await browser.close(); server.close(); }

// ---- T3 Code itself: are the parts the theme hooks into still in the installed app? ------------------------------
// T3 Code's theme guide does not list these as stable. An update can rename one, and then an effect goes away with no
// error. The scan looks for each name in the app's bundle; a miss means: open the app and re-check that effect.
const HOOKS = [
  ["unread glow: sidebar row", "data-sidebar-row"], ["unread glow: thread item", "data-thread-item"],
  ["unread glow: unread row classes", "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover"],
  ["unread glow: woken row classes", "bg-warning/4 hover:bg-warning/8"],
  ["unread glow: read row classes", "text-sidebar-muted-foreground/75"],
  ["send button", "bg-message-action"], ["per-row cards", "data-timeline-root"], ["per-row cards: row kind", "data-timeline-row-kind"],
  ["your message bubble", "data-user-message-bubble"], ["sidebar frame", "sidebar-inner"], ["sidebar frame: container", "sidebar-container"],
  ["header", "data-chat-header"], ["header height", "--workspace-topbar-height"], ["composer", "composer-host"], ["code blocks", "chat-markdown-codeblock"],
];
const asar = process.env.T3_APP_ASAR ?? fs.readdirSync("/tmp").filter((d) => d.startsWith(".mount_T3-Cod")).map((d) => `/tmp/${d}/resources/app.asar`).find((f) => fs.existsSync(f));
if (!asar) console.log("SKIP  T3 Code not found, so its hooks were not checked: set T3_APP_ASAR to its app.asar");
else {
  const app = fs.readFileSync(asar), missing = HOOKS.filter(([, needle]) => !app.includes(needle)).map(([what, needle]) => `${what} (${needle})`);
  hard(!missing.length, `T3 Code at ${asar} still has ${HOOKS.length - missing.length} of the ${HOOKS.length} parts the theme hooks into${missing.length ? "; missing: " + missing.join(", ") : ""}`);
}

console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
process.exit(failed ? 1 : 0);
