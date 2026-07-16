// Coil — reference / proof capture (reference/README.md, specs/proof.md).
//
// Serves a BUILT dist/ over HTTP at 1280×720 (DPR 1) with the project-local Playwright +
// Chromium, seeds a plausible BEST (`coil.best`) and a muted flag (`coil.muted`), and captures
// the three canonical views by driving `window.__coil` / the live Sim exactly the way a key
// press does — `sim.requestTurn` + the synchronous `step()` test hook — so growth, turning and
// the combo behave as in real play:
//   • title      — captured on load, once the produced sprites have finished loading.
//   • gameplay   — start(), then steer the snake to eat pellets along a shortest-path BFS that
//                  treats the snake body AND (maze) the obstacle cells as solid, until the coil
//                  has several bends and the combo has climbed to M ≥ 3; a few non-eating ticks
//                  then drain the window bar so it reads as draining, and the frame is captured.
//   • game-over  — from that gameplay frame, stop steering and run straight into a wall; capture
//                  once state() === "gameover".
// The `#stage` canvas (not the page) is screenshotted, so each PNG is exactly the 1280×720 stage.
//
// Optionally (`--video <path>`) it also records a few-second live round — the normal 125 ms
// timer, NOT step() — where the combo rises past ×2 and its window bar visibly drains, and writes
// it as a .webm (specs/proof.md `proof/combo.webm`).
//
// Usage:
//   node scripts/capture-refs.mjs --build <distProjectDir> --mode <classic|maze> --out <dir>
//                                 [--video <webmPath>] [--best <n>]
//
// `--build` is a project dir containing a built `dist/`. Writes title.png, gameplay.png and
// game-over.png into `--out` (created if missing).

import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const buildDir = path.resolve(arg("build", "."));
const mode = arg("mode", "classic");
const outDir = path.resolve(arg("out", path.join(buildDir, "captures")));
const videoPath = arg("video", null);
const best = arg("best", "640");
const dist = path.join(buildDir, "dist");

if (!existsSync(path.join(dist, "index.html"))) {
  console.error(`capture: ${dist}/index.html missing — run \`npm run build\` in ${buildDir} first.`);
  process.exit(1);
}

// ---- static server for the built dist --------------------------------------
const BASE = "/runs/demo/build"; // a non-root sub-path, exercising the base-path safety
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".map": "application/json",
};
const server = http.createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.startsWith(BASE)) url = url.slice(BASE.length);
  if (url === "/" || url === "") url = "/index.html";
  const file = path.join(dist, url);
  if (!file.startsWith(dist) || !existsSync(file)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}${BASE}/`;

// ---- in-page driving helpers (injected as source into page contexts) --------
// Shortest-path BFS from the head to the pellet over the interior grid (cols 1..28, rows
// 1..16), treating obstacle cells and the snake body (all but the vacating tail) as solid;
// returns the first-step direction (never a reversal). safeDir / nonEatDir are fallbacks.
const HELPERS = `
  const OPP = { up: "down", down: "up", left: "right", right: "left" };
  const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function obstSet(s) {
    const set = new Set();
    for (const o of s.obstacles || []) set.add(o.col + "," + o.row);
    return set;
  }
  function fatalNext(s, obst, nc, nr, willEat) {
    if (nc < 1 || nc > 28 || nr < 1 || nr > 16) return true;
    if (obst.has(nc + "," + nr)) return true;
    const solid = willEat ? s.snake.length : s.snake.length - 1;
    for (let i = 0; i < solid; i++) {
      const c = s.snake[i];
      if (c.col === nc && c.row === nr) return true;
    }
    return false;
  }
  function bfsFirstDir(s) {
    const head = s.snake[0], p = s.pellet, obst = obstSet(s);
    const body = new Set();
    for (let i = 0; i < s.snake.length - 1; i++) body.add(s.snake[i].col + "," + s.snake[i].row);
    const K = (c, r) => c + "," + r;
    const blocked = (c, r) => {
      if (c < 1 || c > 28 || r < 1 || r > 16) return true;
      if (obst.has(K(c, r))) return true;
      if (body.has(K(c, r))) return true;
      return false;
    };
    const start = K(head.col, head.row);
    const prev = new Map([[start, null]]);
    const q = [[head.col, head.row]];
    let found = false;
    while (q.length) {
      const [c, r] = q.shift();
      if (c === p.col && r === p.row) { found = true; break; }
      for (const d of ["up", "down", "left", "right"]) {
        const nc = c + DELTA[d][0], nr = r + DELTA[d][1], k = K(nc, nr);
        if (prev.has(k)) continue;
        if ((nc !== p.col || nr !== p.row) && blocked(nc, nr)) continue;
        prev.set(k, K(c, r)); // predecessor, so the path can be walked back from the pellet
        q.push([nc, nr]);
      }
    }
    if (!found) return null;
    let cur = K(p.col, p.row);
    let pk = prev.get(cur);
    while (pk !== null && pk !== start) { cur = pk; pk = prev.get(cur); }
    if (pk === null) return null;
    const [fc, fr] = cur.split(",").map(Number);
    const dc = fc - head.col, dr = fr - head.row;
    let dir = null;
    if (dc === 1) dir = "right"; else if (dc === -1) dir = "left";
    else if (dr === 1) dir = "down"; else if (dr === -1) dir = "up";
    if (!dir || dir === OPP[s.dir]) return null;
    return dir;
  }
  function safeDir(s) {
    const head = s.snake[0], p = s.pellet, obst = obstSet(s);
    for (const d of ["up", "down", "left", "right"]) {
      if (d === OPP[s.dir]) continue;
      const nc = head.col + DELTA[d][0], nr = head.row + DELTA[d][1];
      const willEat = nc === p.col && nr === p.row;
      if (fatalNext(s, obst, nc, nr, willEat)) continue;
      return d;
    }
    return null;
  }
  function nonEatDir(s) {
    const head = s.snake[0], p = s.pellet, obst = obstSet(s);
    // Prefer a safe direction that does NOT eat, to let the combo window drain a little.
    for (const d of ["up", "down", "left", "right"]) {
      if (d === OPP[s.dir]) continue;
      const nc = head.col + DELTA[d][0], nr = head.row + DELTA[d][1];
      if (nc === p.col && nr === p.row) continue;
      if (fatalNext(s, obst, nc, nr, false)) continue;
      return d;
    }
    return safeDir(s);
  }
  // A safe, non-eating TURN when one exists (perpendicular to the current heading), so the
  // body weaves into a staircase of corners — used while draining the combo window so the
  // captured coil reads as a continuously turning serpent, not a straight tube.
  const AXIS = { up: "v", down: "v", left: "h", right: "h" };
  function weaveDir(s) {
    const head = s.snake[0], p = s.pellet, obst = obstSet(s);
    const perp = [], straight = [];
    for (const d of ["up", "down", "left", "right"]) {
      if (d === OPP[s.dir]) continue;
      const nc = head.col + DELTA[d][0], nr = head.row + DELTA[d][1];
      if (nc === p.col && nr === p.row) continue; // don't eat — keep the window draining
      if (fatalNext(s, obst, nc, nr, false)) continue;
      (AXIS[d] !== AXIS[s.dir] ? perp : straight).push(d);
    }
    if (perp.length) return perp[0];   // turn if we safely can → a bend this tick
    if (straight.length) return straight[0];
    return safeDir(s);
  }
`;

// ---- launch -----------------------------------------------------------------
const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function newSeededPage(context) {
  const page = await context.newPage();
  await page.addInitScript(
    ([b]) => {
      localStorage.setItem("coil.best", b);
      localStorage.setItem("coil.muted", "1");
    },
    [best],
  );
  return page;
}

function assertPng1280x720(file) {
  const buf = readFileSync(file);
  // PNG: 8-byte signature, then IHDR chunk; width @ offset 16, height @ offset 20 (big-endian).
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== 1280 || h !== 720) throw new Error(`${file} is ${w}x${h}, expected 1280x720`);
  return `${w}x${h}`;
}

const errors = [];
function watch(page) {
  page.on("console", (m) => m.type() === "error" && errors.push(`CONSOLE: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("requestfailed", (r) => errors.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));
}

await mkdir(outDir, { recursive: true });

// ---- screenshots (title / gameplay / game-over) -----------------------------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await newSeededPage(context);
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__coil, null, { timeout: 8000 });
  await page.waitForTimeout(400); // let a couple of RAF frames render the loaded sprites

  const modeOnPage = await page.evaluate(() => window.__coil.mode());
  if (modeOnPage !== mode) {
    console.warn(`capture: build reports mode="${modeOnPage}" but --mode="${mode}"`);
  }

  const stage = page.locator("#stage");

  // title
  await stage.screenshot({ path: path.join(outDir, "title.png") });

  // gameplay — drive to a coiled, M>=3 frame, then drain the window bar a little.
  const play = await page.evaluate(`(function(){
    ${HELPERS}
    const C = window.__coil;
    C.start();
    let eats = 0, guard = 0;
    while (guard++ < 8000) {
      const s = C.sim;
      if (s.ended) { C.start(); eats = 0; continue; }
      if (s.combo >= 3 && eats >= 7 && s.snake.length >= 10) break;
      let d = bfsFirstDir(s) || safeDir(s);
      if (!d) { C.start(); eats = 0; continue; }
      const sc = s.score;
      s.requestTurn(d);
      C.step(1);
      if (!s.ended && s.score > sc) eats++;
    }
    // Weave a few non-eating ticks so the coil shows several bends AND the window bar reads as
    // draining (combo stays >= 3: 6 ticks ≈ 0.75 s of the 3.5 s window).
    for (let i = 0; i < 6; i++) {
      const s = C.sim;
      if (s.ended || s.combo < 3) break;
      const d = weaveDir(s);
      if (d) s.requestTurn(d);
      C.step(1);
    }
    const s = C.sim;
    return { state: C.state(), combo: s.combo, len: s.snake.length, score: s.score, frac: s.comboFraction() };
  })()`);
  console.log(`  gameplay: state=${play.state} combo=x${play.combo} len=${play.len} score=${play.score} barFrac=${play.frac.toFixed(2)}`);
  await page.waitForTimeout(120); // one render tick so the drawn frame matches sim state
  await stage.screenshot({ path: path.join(outDir, "gameplay.png") });

  // game-over — stop steering, run straight into a wall, capture the panel.
  const over = await page.evaluate(`(function(){
    const C = window.__coil;
    const s = C.sim;
    for (let i = 0; i < 120 && !s.ended; i++) C.step(1);
    return { state: C.state(), score: s.score };
  })()`);
  console.log(`  game-over: state=${over.state} score=${over.score}`);
  await page.waitForTimeout(120);
  await stage.screenshot({ path: path.join(outDir, "game-over.png") });

  await context.close();

  for (const f of ["title.png", "gameplay.png", "game-over.png"]) {
    const dims = assertPng1280x720(path.join(outDir, f));
    console.log(`  wrote ${path.join(outDir, f)} (${dims})`);
  }
}

// ---- combo video (live round, real timer) -----------------------------------
if (videoPath) {
  const videoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".video");
  await rm(videoDir, { recursive: true, force: true });
  await mkdir(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await newSeededPage(context);
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__coil, null, { timeout: 8000 });
  await page.waitForTimeout(300);

  // Start a LIVE round (no step(): the normal 125 ms timer ticks it) and steer it toward
  // pellets on a fast interval so the combo climbs past ×2 and the window bar drains on camera.
  await page.evaluate(`(function(){
    ${HELPERS}
    const C = window.__coil;
    C.start();
    window.__driveId = setInterval(function () {
      const st = C.state();
      if (st !== "playing") { if (st === "gameover" || st === "cleared") C.start(); return; }
      const s = C.sim;
      const d = bfsFirstDir(s) || safeDir(s);
      if (d) s.requestTurn(d);
    }, 60);
  })()`);
  await page.waitForTimeout(5200); // a few seconds of live play
  await page.evaluate(() => clearInterval(window.__driveId));

  await page.close(); // finalizes the recording
  const src = await page.video().path();
  await context.close();
  await mkdir(path.dirname(videoPath), { recursive: true });
  await copyFile(src, videoPath);
  console.log(`  wrote ${videoPath} (video)`);
}

await browser.close();
server.close();

if (errors.length) {
  console.error(`capture: ${errors.length} console/page/request error(s):`);
  for (const e of errors.slice(0, 25)) console.error("   -", e);
  process.exit(1);
}
console.log("CAPTURE OK");
