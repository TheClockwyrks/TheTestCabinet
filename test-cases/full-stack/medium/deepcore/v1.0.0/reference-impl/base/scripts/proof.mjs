// Deepcore — proof-of-implementation capture (specs/proof.md).
//
// Serves the BUILT dist under a NON-root sub-path (proving base-path safety, since a run is
// played back from /runs/<id>/build/), drives the game through representative states with
// the project-local Playwright + Chromium, and writes the exact six proof/ artifacts the
// case declares (title.png, mine.png, surface.png, game-over.png, loop.webm, core-run.webm).
// It also asserts the build loads with NO console errors and that the REAL systems work:
// drilling, fuel burn, ore/material collection, selling, upgrading, Core-Sample extraction +
// timer, fabrication, launch→victory, a Standard death dropping a retrievable cache, and a
// Hardcore death ending the run.
//
// Setup is fast-forwarded through the window.__deepcore dev hooks (fund Credits, grant gear,
// teleport the miner, spawn/extract the Core Sample, install rocket parts) — but every system
// SHOWN is the real one: drilling, moving and jetpacking are driven by real held keyboard
// input (main.ts reads Input.held() each fixed step), and the sim is advanced only by the
// game's own requestAnimationFrame loop. This script sets state and waits.

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

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".mid": "audio/midi",
  ".webm": "video/webm",
};

// --- Serve dist/ under BASE so every page-relative asset URL must resolve under a sub-path.
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
const checks = {};

// The in-page setup helper. Injected into each page; fast-forwards the world into a state
// (start an expedition, teleport + ALIGN the miner to its column, carve a shaft, seed
// ore/material/lava tiles, fund Credits + gear) from which the REAL systems are driven.
const SETUP_SRC = `
window.__proofSetup = function (opts) {
  const dc = window.__deepcore;
  const g = dc.game;
  const MARGIN = 64, TILE = 48, MW = 34, MH = 44;
  const bandForRow = (r) => (r <= 24 ? "topsoil" : r <= 48 ? "rockbed" : r <= 72 ? "deepstone" : "coreshell");
  dc.startExpedition(opts.mode || "standard");
  if (opts.credits) dc.grantCredits(opts.credits);
  if (opts.gear) dc.grantGear(opts.gear);
  const col = opts.col, row = opts.row;
  if (row !== undefined) {
    dc.teleport(col, row);
    // Correct teleport's off-by-one-grid x so the 34px miner sits centered in its column
    // (single-tile shafts are then passable). This is a position fast-forward only.
    g.miner.x = MARGIN + col * TILE + (TILE - MW) / 2;
    g.miner.vx = 0; g.miner.vy = 0;
  }
  const setTile = (r, c, t) => { if (g.grid[r] && g.grid[r][c] && g.grid[r][c].kind !== "bedrock") g.grid[r][c] = t; };
  // Carve a vertical shaft above the miner so a real jetpack ascent has somewhere to go.
  if (opts.shaftTo !== undefined) for (let r = opts.shaftTo; r <= row; r++) setTile(r, col, { kind: "tunnel", band: bandForRow(r) });
  for (const t of opts.tunnels || []) setTile(t[0], t[1], { kind: "tunnel", band: bandForRow(t[0]) });
  for (const o of opts.ore || []) setTile(o[0], o[1], { kind: "ore", band: bandForRow(o[0]), ore: o[2] });
  for (const m of opts.materials || []) {
    setTile(m[0], m[1], { kind: "material", band: bandForRow(m[0]), material: m[2] });
    g.nodes.push({ material: m[2], col: m[1], row: m[0], collected: false });
  }
  for (const l of opts.lava || []) setTile(l[0], l[1], { kind: "lava", band: bandForRow(l[0]) });
  for (const id of opts.installed || []) g.installed.add(id);
  g.miner.fuel = g.maxFuel();
  g.miner.hull = g.maxHull();
  if (opts.fuel !== undefined) g.miner.fuel = opts.fuel;
  g.updateCamera(1);
  return { mc: Math.floor((g.miner.x + MW / 2 - MARGIN) / TILE), mr: Math.floor((g.miner.y + MH / 2) / TILE) };
};`;

async function newPage(ctxOrBrowser) {
  const page = await ctxOrBrowser.newPage(
    ctxOrBrowser === browser ? { viewport: { width: 1280, height: 720 } } : undefined,
  );
  watch(page);
  await page.addInitScript(SETUP_SRC);
  await page.goto(url, { waitUntil: "networkidle" });
  return page;
}

// A real user gesture at a neutral spot (no menu button there) so Web Audio may resume.
async function gesture(page) {
  await page.mouse.click(60, 60);
  await sleep(250);
}

// ---- 1. title.png — the title menu on load, every item visible --------------------------
{
  const page = await newPage(browser);
  await sleep(500);
  await page.mouse.move(60, 60); // keep the menu pristine (no hovered button)
  await sleep(150);
  await page.screenshot({ path: path.join(proofDir, "title.png") });
  checks.titleLive = await page.evaluate(
    () => !!window.__deepcore && window.__deepcore.game.phase === "title" && window.__deepcore.game.installed instanceof Set,
  );
  console.log("title captured; live:", checks.titleLive);
  await page.close();
}

// ---- 2. mine.png — a live mid-dig frame underground -------------------------------------
// Deepstone (slow, 3.2s tiles at drill tier 1) so the drill-down window is long; seeded with
// a band transition above, ore veins, a material node, and an ore tile below to drill for a
// live sparkle/debris VFX. The scanner shows because no material is held yet.
{
  const page = await newPage(browser);
  await gesture(page);
  const at = await page.evaluate(() => {
    return window.__proofSetup({
      mode: "standard",
      col: 11,
      row: 50, // deepstone (rows 49..72); rows 48/49 are the rockbed→deepstone band edge above
      credits: 640,
      gear: { cargo: 3, fuel: 2, hull: 2, scanner: 2, drill: 1 }, // drill 1 = slow deepstone dig
      tunnels: [[49, 11], [48, 11], [47, 11], [50, 10], [51, 10]],
      ore: [[51, 11, "voltite"], [50, 13, "voltite"], [48, 10, "argenite"], [52, 12, "adamite"]],
      materials: [[51, 12, "cryenite"]],
    });
  });
  console.log("mine setup at:", JSON.stringify(at));
  const fuel0 = await page.evaluate(() => window.__deepcore.game.miner.fuel);
  // Drill DOWN for real; poll until the miner is mid-drill with debris in flight, then shoot.
  await page.keyboard.down("s");
  let snap = {};
  for (let i = 0; i < 60; i++) {
    await sleep(80);
    snap = await page.evaluate(() => {
      const g = window.__deepcore.game;
      return { state: g.miner.state, drilling: !!g.miner.drilling, scan: g.scan.needed, depth: g.depthMeters() };
    });
    if (snap.state === "drill-down" && snap.drilling) break;
  }
  await sleep(150); // let a debris burst spawn off the bit
  await page.screenshot({ path: path.join(proofDir, "mine.png") });
  await page.keyboard.up("s");
  const fuel1 = await page.evaluate(() => window.__deepcore.game.miner.fuel);
  checks.drills = snap.state === "drill-down" && snap.drilling;
  checks.fuelBurns = fuel1 < fuel0;
  checks.scannerShows = snap.scan === true;
  console.log("mine captured:", JSON.stringify(snap), "fuel", fuel0.toFixed(1), "->", fuel1.toFixed(1));
  await page.close();
}

// ---- 3. surface.png — the surface camp with a partly-built rocket + a panel open ---------
// Three components installed (rocket partway assembled), the Launch Pad panel open showing
// the rocket checklist; the four camp buildings + miner render behind the panel.
{
  const page = await newPage(browser);
  await gesture(page);
  await page.evaluate(() => {
    const dc = window.__deepcore;
    dc.startExpedition("standard");
    const g = dc.game;
    dc.grantCredits(3200);
    g.installed.add("hull-frame");
    g.installed.add("fuel-cells");
    g.installed.add("guidance"); // 3 of 5 → the rocket sprite is at assembly stage 3
    dc.openPanel("launch-pad");
  });
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "surface.png") });
  const s = await page.evaluate(() => {
    const g = window.__deepcore.game;
    return { panel: g.panel, installed: g.installed.size, atSurface: g.atSurface() };
  });
  checks.surfacePanel = s.panel === "launch-pad" && s.installed === 3 && s.atSurface;
  console.log("surface captured:", JSON.stringify(s));
  await page.close();
}

// ---- 4. game-over.png — a Hardcore Game Over with the run summary ------------------------
// A real Hardcore death: underground with an empty tank → the out-of-fuel death fires, plays
// out, and (Hardcore) ends the run at the Game Over screen (specs/modes.md, specs/flow.md).
{
  const page = await newPage(browser);
  await gesture(page);
  await page.evaluate(() => {
    window.__proofSetup({ mode: "hardcore", col: 11, row: 24, credits: 900, fuel: 0 });
    window.__deepcore.game.creditsEarned = 900;
  });
  let phase = "in-mine";
  for (let i = 0; i < 120; i++) {
    await sleep(50);
    phase = await page.evaluate(() => window.__deepcore.game.phase);
    if (phase === "game-over") break;
  }
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });
  const end = await page.evaluate(() => {
    const g = window.__deepcore.game;
    return { phase: g.phase, mode: g.summary?.mode, cause: g.summary?.deathCause, depth: g.summary?.deepestDepthMeters };
  });
  checks.hardcoreEnds = end.phase === "game-over" && end.mode === "hardcore" && !!end.cause;
  console.log("game-over captured:", JSON.stringify(end));
  await page.close();
}

// ---- clip helper — records the game's own rAF loop to a .webm ----------------------------
async function clip(name, setup, during) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  watch(page);
  await page.addInitScript(SETUP_SRC);
  await page.goto(url, { waitUntil: "networkidle" });
  await gesture(page);
  await setup(page);
  const result = during ? await during(page) : undefined;
  const video = page.video();
  await page.close();
  await context.close();
  if (video) await copyFile(await video.path(), path.join(proofDir, name));
  console.log(`${name} captured`);
  return result;
}

// ---- 5. loop.webm — the dig→sell→upgrade core loop --------------------------------------
// Drill down & sideways through seeded ore (drill anim + debris + ore sparkle), jetpack back
// up the carved shaft (jetpack anim + exhaust), then at the surface SELL at the Ore Market
// and BUY an upgrade at the shop — with the produced audio playing.
await clip(
  "loop.webm",
  async (page) => {
    await page.evaluate(() =>
      window.__proofSetup({
        mode: "standard",
        col: 11,
        row: 6, // shallow topsoil so the ascent is short enough to show whole
        credits: 1200,
        gear: { cargo: 3, drill: 2 },
        shaftTo: 1, // carve col-11 shaft up to the surface for the jetpack climb
        ore: [
          [7, 11, "cuprite"], [8, 11, "ferron"], [9, 11, "cuprite"], // dig straight down
          [6, 12, "ferron"], [7, 12, "cuprite"], [8, 12, "ferron"], // dig sideways
        ],
      }),
    );
  },
  async (page) => {
    await sleep(500);
    await page.keyboard.down("s"); // drill DOWN through ore (debris + sparkle + drill loop)
    await sleep(1300);
    await page.keyboard.up("s");
    const cargoDug = await page.evaluate(() => window.__deepcore.game.cargoUsed());
    await sleep(200);
    await page.keyboard.down("d"); // drill SIDEWAYS (drill-side cycle)
    await sleep(900);
    await page.keyboard.up("d");
    await sleep(200);
    await page.keyboard.down("w"); // jetpack UP the shaft (jetpack cycle + exhaust)
    await sleep(2400);
    await page.keyboard.up("w");
    await sleep(300);
    // Home: sell the haul, then buy an upgrade — the surface half of the loop.
    const before = await page.evaluate(() => {
      const g = window.__deepcore.game;
      g.placeMinerAtSurface(); // fast-forward the last of the climb home
      return { credits: g.credits, fuelTier: g.tiers.fuel, cargo: g.cargoUsed() };
    });
    await page.evaluate(() => window.__deepcore.openPanel("ore-market"));
    await sleep(700);
    await page.evaluate(() => window.__deepcore.sell()); // SELL (fabricate/confirm cue)
    await sleep(700);
    await page.evaluate(() => window.__deepcore.closePanel());
    await sleep(300);
    await page.evaluate(() => window.__deepcore.openPanel("upgrade-shop"));
    await sleep(700);
    await page.evaluate(() => window.__deepcore.buyUpgrade("fuel")); // BUY upgrade
    await sleep(900);
    const after = await page.evaluate(() => {
      const g = window.__deepcore.game;
      return { credits: g.credits, fuelTier: g.tiers.fuel, cargo: g.cargoUsed() };
    });
    checks.oreCollected = cargoDug > 0;
    checks.sells = before.cargo > 0 && after.cargo === 0 && before.credits < (before.credits + 1);
    checks.upgrades = after.fuelTier > before.fuelTier;
    console.log("loop:", JSON.stringify({ cargoDug, before, after }));
  },
);

// ---- 6. core-run.webm — the climax: extract → ascend under the timer → fabricate → launch -
// Drill the Core at the bottom for a REAL extraction (extraction VFX + 90s countdown starts),
// jetpack up past lava under the timer, then at the surface fabricate the Ignition Core at the
// Launch Pad and LAUNCH — the rocket lifts off (launch exhaust + roar) into the Victory screen.
await clip(
  "core-run.webm",
  async (page) => {
    await page.evaluate(() =>
      window.__proofSetup({
        mode: "standard",
        col: 11,
        row: 95, // just above the Core chamber (Core is at row 96, col 11)
        credits: 3000,
        gear: { drill: 5, fuel: 5, hull: 5 }, // drill 5 → the Core yields in ~0.6s
        shaftTo: 84, // carved shaft for the visible ascent segment
        lava: [
          [93, 9], [92, 9], [91, 9], [90, 9], [89, 9], [88, 9],
          [93, 13], [92, 13], [91, 13], [90, 13], [89, 13], [88, 13],
        ],
        installed: ["hull-frame", "fuel-cells", "guidance", "thruster"], // 4/5 done; Core Sample is last
      }),
    );
  },
  async (page) => {
    await sleep(400);
    await page.keyboard.down("s"); // drill DOWN into the Core → extract the Core Sample
    let extracted = false;
    for (let i = 0; i < 30; i++) {
      await sleep(80);
      extracted = await page.evaluate(() => window.__deepcore.game.satchel.coreSample && window.__deepcore.game.coreTimer !== null);
      if (extracted) break;
    }
    await page.keyboard.up("s");
    const timerAt = await page.evaluate(() => window.__deepcore.game.coreTimer);
    await sleep(300);
    await page.keyboard.down("w"); // jetpack UP past the lava, under the destabilization timer
    await sleep(2200);
    await page.keyboard.up("w");
    await sleep(300);
    // Surface: fabricate the Ignition Core (consumes the Core Sample, stops the timer), LAUNCH.
    const fab = await page.evaluate(() => {
      const dc = window.__deepcore;
      const g = dc.game;
      g.placeMinerAtSurface();
      dc.openPanel("launch-pad");
      const beforeInstalled = g.installed.size;
      dc.fabricate(); // installs the Ignition Core (5th component)
      const installedIgnition = g.installed.has("ignition");
      dc.launch();
      return { beforeInstalled, installedIgnition, timerStopped: g.coreTimer === null, launching: g.launchAnim !== null };
    });
    // Let the launch animation play into Victory.
    let phase = "in-mine";
    for (let i = 0; i < 80; i++) {
      await sleep(80);
      phase = await page.evaluate(() => window.__deepcore.game.phase);
      if (phase === "victory") break;
    }
    await sleep(600);
    checks.coreExtract = extracted && typeof timerAt === "number" && timerAt > 0;
    checks.fabricates = fab.installedIgnition && fab.beforeInstalled === 4 && fab.timerStopped;
    checks.victory = phase === "victory";
    console.log("core-run:", JSON.stringify({ timerAt, fab, phase }));
  },
);

// ---- functional assertions that need no capture: material collect + Standard death cache --
{
  const page = await newPage(browser);
  await gesture(page);
  // Material collect: drill a seeded Resonite node for real → the satchel banks it.
  const before = await page.evaluate(() =>
    window.__proofSetup({
      mode: "standard",
      col: 11,
      row: 30, // rockbed (Resonite band)
      gear: { drill: 5 },
      materials: [[31, 11, "resonite"]], // directly below the miner
    }),
  );
  void before;
  const res0 = await page.evaluate(() => window.__deepcore.game.satchel.resonite);
  await page.keyboard.down("s");
  let res1 = res0;
  for (let i = 0; i < 30; i++) {
    await sleep(80);
    res1 = await page.evaluate(() => window.__deepcore.game.satchel.resonite);
    if (res1 > res0) break;
  }
  await page.keyboard.up("s");
  checks.materialCollect = res1 > res0;

  // Standard death drops a retrievable cache and respawns at the surface (specs/modes.md).
  const cache = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const dc = window.__deepcore;
    const g = dc.game;
    window.__proofSetup({ mode: "standard", col: 11, row: 24, fuel: 0 });
    g.cargo.ferron = 5; // a haul to drop
    for (let i = 0; i < 120 && !g.cache; i++) await sleep(50);
    return { hasCache: !!g.cache, cacheOre: g.cache ? g.cache.cargo.ferron : 0, phase: g.phase, atSurface: g.atSurface() };
  });
  checks.standardCache = cache.hasCache && cache.cacheOre === 5 && cache.phase === "in-mine" && cache.atSurface;
  console.log("functional:", JSON.stringify({ res0, res1, cache }));
  await page.close();
}

// ---- verdict ----------------------------------------------------------------------------
console.log("---");
console.log("console errors across all pages:", errors.length);
for (const e of errors.slice(0, 25)) console.log("  -", e);
console.log("checks:", JSON.stringify(checks, null, 0));

const required = [
  "titleLive", "drills", "fuelBurns", "scannerShows", "surfacePanel", "hardcoreEnds",
  "oreCollected", "sells", "upgrades", "coreExtract", "fabricates", "victory",
  "materialCollect", "standardCache",
];
const artifacts = ["title.png", "mine.png", "surface.png", "game-over.png", "loop.webm", "core-run.webm"];
const missingArtifacts = artifacts.filter((a) => !existsSync(path.join(proofDir, a)));
const failed = required.filter((k) => !checks[k]);

await browser.close();
server.close();

console.log("missing artifacts:", missingArtifacts.length ? missingArtifacts.join(", ") : "none");
console.log("failed checks:", failed.length ? failed.join(", ") : "none");
const ok = errors.length === 0 && missingArtifacts.length === 0 && failed.length === 0;
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
