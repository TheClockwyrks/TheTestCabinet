// Junction — proof-of-implementation capture (specs/proof.md, DESIGN §6).
//
// Serves the BUILT dist under a non-root sub-path (proving base-path safety), drives the
// game through representative states with the project-local Playwright + Chromium via the
// `window.__junction` scripted control surface, and writes the exact proof/ artifacts the
// case declares. It also asserts the build loads with no console errors and that the
// develop/transit/utility systems, the budget, and the bankruptcy end-state actually work.
//
// The city is scripted deterministically (seed 0x4a554e43): a core R/C/I block wired to
// three power plants and fed water from river-side sources, a riverside residential pocket
// (water amenity → higher land value), and a rail line with stations that lifts land value
// so districts climb past the first density tier. Every helper drives real Game methods.

import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");
const proofDir = path.join(root, "proof");
const videoDir = path.join(here, ".video");
const BASE = "/runs/demo/build";
const SEED = 0x4a554e43;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wav": "audio/wav", ".png": "image/png" };

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

await mkdir(proofDir, { recursive: true });
await rm(videoDir, { recursive: true, force: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];
function watch(page) {
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("requestfailed", (r) => errors.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- The scripted city (runs in-page against the real Game via window.__junction) --------
// `treasury` seeds the running balance; `zoomOn` frames the developed core for a capture.
function buildCity(page, { treasury = 140000 } = {}) {
  return page.evaluate((t) => {
    const J = window.__junction, g = J.game, COLS = g.world.cols;
    const idx = (c, r) => r * COLS + c;
    const TERR = ["earth", "grass", "water", "hill"];
    // Read the terrain through the live `g.world` view each call: placing carriers can grow
    // the wasm memory, which detaches any previously-captured typed-array view.
    const terr = (c, r) => TERR[g.world.terrain[idx(c, r)]];
    J.newCity(0x4a554e43);
    J.setTreasury(t);

    const BC0 = 32, BC1 = 66, TOP = 30, BOT = 44;
    // Even-row road+wire+pipe service corridors across the core block.
    for (let r = TOP; r <= BOT; r += 2) { J.road(BC0, r, BC1, r); J.wire(BC0, r, BC1, r); J.pipe(BC0, r, BC1, r); }
    // Vertical connectors every 6 cols so traffic spreads and utilities reach every lot.
    for (let c = BC0; c <= BC1; c += 6) { J.road(c, TOP, c, BOT); J.wire(c, TOP, c, BOT); J.pipe(c, TOP, c, BOT); }
    // The three zones, painted as a rectangle over the wired block (odd rows develop).
    J.zoneRect("res", 32, 30, 42, 44);
    J.zoneRect("com", 44, 30, 54, 44);
    J.zoneRect("ind", 56, 30, 66, 44);
    // A riverside RES pocket hugging the river — the water amenity lifts land value.
    const PC0 = 44, PC1 = 52, PTOP = 16, PBOT = 22;
    for (let r = PTOP; r <= PBOT; r += 2) { J.road(PC0, r, PC1, r); J.wire(PC0, r, PC1, r); J.pipe(PC0, r, PC1, r); }
    J.road(PC0, PTOP, PC0, PBOT); J.wire(PC0, PTOP, PC0, PBOT); J.pipe(PC0, PTOP, PC0, PBOT);
    J.zoneRect("res", PC0, PTOP, PC1, PBOT);
    J.road(44, PBOT, 44, TOP); J.wire(44, PBOT, 44, TOP); J.pipe(44, PBOT, 44, TOP);
    // Power: three plants adjacent to the core wire net (2×2 to the west of col 32).
    J.plant(30, 30); J.plant(30, 38); J.plant(30, 44);
    // Water: sources placed beside the river with a pipe trunk down into the core net.
    const addSource = (targetCol) => {
      for (let r = 6; r <= 28; r++) {
        if (terr(targetCol, r) === "water") {
          const anchor = r + 1;
          if (J.source(targetCol, anchor).placed > 0) { J.pipe(targetCol, anchor + 2, targetCol, TOP); return; }
        }
      }
    };
    [34, 40, 62].forEach(addSource);
    // A rail line below the core with stations on it that touch the core road — a station
    // lifts nearby land value, so the southern rows climb to the second density tier.
    J.rail(38, 45, 62, 45);
    for (const c of [38, 44, 50, 56, 62]) J.station(c, 45);
    g.selectTool(null); g.setSelected(-1); g.setOverlay("none");
  }, treasury);
}

// Frame + settle: center the camera on the developed core at a fitted zoom.
async function frameCore(page, zoom = 20) {
  await page.evaluate((z) => {
    const g = window.__junction.game;
    g.camera.zoom = z;
    g.centerOn(49, 30);
    g.selectTool(null); g.setSelected(-1);
  }, zoom);
}

// ---- 1. title.png -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(500);
  await page.mouse.move(1000, 600); // pointer off the menu for a clean title
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "title.png") });
  const st = await page.evaluate(() => window.__junction.game.state);
  console.log("title captured; state:", st);
  await page.close();
}

// ---- 2. gameplay.png (a developed, multi-tier city) ---------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200); // audio gesture
  await sleep(300);
  await buildCity(page, { treasury: 140000 });
  await page.evaluate(() => window.__junction.advance(30)); // develop to tiers 1–2 (instant)
  await frameCore(page, 20);
  await page.mouse.move(1000, 340);
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "gameplay.png") });
  const snap = await page.evaluate(() => {
    const g = window.__junction.game, w = g.world, C = w.cols * w.rows;
    const per = { res: [0, 0, 0, 0], com: [0, 0, 0, 0], ind: [0, 0, 0, 0] };
    const Z = ["", "res", "com", "ind"];
    for (let i = 0; i < C; i++) if (w.zone[i] && w.tier[i] > 0) per[Z[w.zone[i]]][w.tier[i]]++;
    const s = window.__junction.snapshot();
    return { per, pop: s.population, treasury: s.treasury, balance: s.balance, veh: g.vehicles.length };
  });
  console.log("gameplay captured:", JSON.stringify(snap));
  await page.close();
}

// ---- 3. game-over.png (bankruptcy tally) --------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200);
  await sleep(300);
  await buildCity(page, { treasury: 140000 });
  await page.evaluate(() => window.__junction.advance(18)); // grow a real peak population
  // Strip income (tax → 0) and run credit down to the debt limit → a bankrupt settle.
  await page.evaluate(() => {
    window.__junction.setTreasury(1500);
    window.__junction.forceBankruptcy();
    window.__junction.advance(60);
  });
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });
  const end = await page.evaluate(() => {
    const g = window.__junction.game;
    return { state: g.state, peak: g.stats.peakPopulation, months: g.stats.monthsSurvived, treasury: Math.round(g.budget.treasury) };
  });
  console.log("game-over captured:", JSON.stringify(end));
  await page.close();
}

// ---- clip helper --------------------------------------------------------------
async function clip(name, setup, seconds) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200); // audio gesture
  await sleep(300);
  await setup(page);
  await sleep(seconds * 1000);
  const video = page.video();
  await page.close();
  await context.close();
  if (video) await copyFile(await video.path(), path.join(proofDir, name));
  console.log(`${name} captured`);
}

// ---- 4. systems.webm (city systems developing + traffic overlay) --------------
await clip(
  "systems.webm",
  async (page) => {
    await buildCity(page, { treasury: 160000 });
    await page.evaluate(() => window.__junction.advance(20)); // an already-running city
    await frameCore(page, 20);
    // Turn on the traffic overlay and open a FRESH block so it develops live during the
    // clip (construction dust, buildings rising) while vehicles path and roads congest.
    await page.evaluate(() => {
      const J = window.__junction, g = J.game;
      g.setOverlay("traffic");
      g.speed = 3;
      // A new residential strip east of the core, wired + roaded so it develops on camera.
      for (let r = 30; r <= 44; r += 2) { J.road(68, r, 78, r); J.wire(68, r, 78, r); J.pipe(68, r, 78, r); }
      J.road(68, 30, 68, 44); J.wire(68, 30, 68, 44); J.pipe(68, 30, 68, 44);
      J.wire(66, 32, 68, 32); J.pipe(66, 32, 68, 32); J.road(66, 32, 68, 32); // tie into the core nets
      J.zoneRect("res", 68, 30, 78, 44);
      g.selectTool(null); g.setSelected(-1);
    });
  },
  7,
);

// ---- 5. crisis.webm (budget pressure → bankruptcy, audio left on) -------------
await clip(
  "crisis.webm",
  async (page) => {
    await buildCity(page, { treasury: 160000 });
    await page.evaluate(() => window.__junction.advance(16)); // a developed, populated city
    // Drop the treasury near the alert threshold, strip income, run fast: the per-period
    // balance goes negative, the treasury falls, the LOSING MONEY alert fires, and the city
    // slides toward (and reaches) bankruptcy on camera. Audio is left un-muted.
    await page.evaluate(() => {
      const J = window.__junction, g = J.game;
      J.setTreasury(5200);
      g.setOverlay("none");
      window.__junction.forceBankruptcy(); // tax → 0
      g.speed = 3;
    });
  },
  8,
);

// ---- functional assertions (systems, economy, bankruptcy end-state) -----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200);
  await sleep(300);
  await buildCity(page, { treasury: 140000 });
  const checks = await page.evaluate(() => {
    const J = window.__junction, g = J.game;
    J.advance(24);
    // Capture the tile view AFTER advancing (the sim step can grow wasm memory and detach an
    // earlier view); reading through `g.world` here gives the current, live-backed arrays.
    const w = g.world, C = w.cols * w.rows;
    let tier1 = 0, tier2 = 0, developed = 0, poweredDev = 0, wateredDev = 0, ind = 0;
    for (let i = 0; i < C; i++) {
      if (w.zone[i] && w.tier[i] > 0) {
        developed++;
        if (w.tier[i] >= 1) tier1++;
        if (w.tier[i] >= 2) tier2++;
        if (w.powered[i]) poweredDev++;
        if (w.watered[i]) wateredDev++;
        if (w.zoneAt(i) === "ind") ind++;
      }
    }
    const anyPollution = w.pollution.some((p) => p > 0.5);
    const grew = g.stats.peakPopulation > 200;
    const vehicles = g.vehicles.length > 0;

    // Bankruptcy reachable: strip income and burn credit down.
    J.setTreasury(1200);
    J.forceBankruptcy();
    J.advance(80);
    const bankruptReachable = g.state === "bankrupt";
    return { developed, tier1, tier2, poweredDev, wateredDev, ind, anyPollution, grew, vehicles, peak: g.stats.peakPopulation, bankruptReachable };
  });
  console.log("functional checks:", JSON.stringify(checks));
  await page.close();
  globalThis.__checks = checks;
}

console.log("---");
console.log("console errors across all pages:", errors.length);
for (const e of errors.slice(0, 25)) console.log("  -", e);

await browser.close();
server.close();

const c = globalThis.__checks || {};
const filesOk = ["title.png", "gameplay.png", "game-over.png", "systems.webm", "crisis.webm"].every((f) => existsSync(path.join(proofDir, f)));
const ok = errors.length === 0 && filesOk && c.developed > 40 && c.tier2 > 0 && c.poweredDev > 0 && c.wateredDev > 0 && c.grew && c.vehicles && c.anyPollution && c.bankruptReachable;
console.log("files present:", filesOk);
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
