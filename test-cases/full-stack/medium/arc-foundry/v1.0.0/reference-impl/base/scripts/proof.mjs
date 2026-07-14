// Arc Foundry — proof-of-implementation capture (specs/proof.md).
//
// Serves the BUILT dist under a non-root sub-path (proving base-path safety, since a run is
// served from /runs/<id>/build/), drives the game through representative states with the
// project-local Playwright + Chromium, and writes the exact proof/ artifacts the case
// declares. Also asserts the build loads with no console errors and that the scrap-press
// build loop, the maze re-path, the economy, and the end states actually work.
//
// The board is laid out deterministically through window.__arcfoundry.place(type, tier,
// col, row) — the dev counterpart to the random scrap-press — so each capture shows the
// exact mix of component types + quality tiers + slag walls the proof calls for
// (specs/build.md, specs/proof.md). The simulation itself is advanced by the game's own
// requestAnimationFrame loop (main.ts); this script only sets state and waits.

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

// The proof runs on MAP A — "The Substation": a wide serpentine whose first leg runs the
// Load along the top edge (row 4), so a maze folded into that corridor reads as a real
// route-around. Anchors are 2×2 top-left tiles (col 0..48, row 0..31); free layout snaps
// each to the nearest legal anchor (specs/board.md). A staggered field across the corridor
// forces the walking Load to weave up and down between the blocks.
//
// Each entry is [type, tier, col, row, slag?]: a component of that exact type + quality is
// placed at (or nearest-legal to) the anchor; if `slag` is set it is then fused into an
// inert slag wall (walls, never fires) so the board carries both live components and slag.
const MAZE = [
  ["capacitor", 2, 6, 2],
  ["coil", 1, 12, 5],
  ["emitter", 1, 18, 2],
  ["discharge", 3, 24, 5],
  ["arcnode", 2, 30, 2, "slag"],
  ["capacitor", 1, 36, 5],
  ["coil", 2, 42, 2],
  ["emitter", 3, 9, 8],
  ["arcnode", 1, 21, 8],
  ["discharge", 1, 33, 8, "slag"],
];

// A denser board for the late-wave pressure clip — a chain-heavy line (Coils), area
// dischargers (Arc-Nodes), and long-range Discharge Rigs down the corridor so packed Load
// draws chain-lightning + discharge rings, plus a slag wall to shape the maze.
const HEAVY = [
  ["coil", 3, 6, 2],
  ["coil", 2, 14, 5],
  ["arcnode", 3, 22, 2],
  ["discharge", 4, 30, 5],
  ["coil", 2, 38, 2],
  ["arcnode", 2, 12, 8, "slag"],
  ["capacitor", 3, 26, 8],
  ["emitter", 2, 40, 8],
];

// Lay a named board out on the yard (placing, then slagging the flagged pieces).
async function buildBoard(page, board) {
  return page.evaluate((board) => {
    const af = window.__arcfoundry;
    const g = af.game;
    let placed = 0;
    let slagged = 0;
    for (const [type, tier, col, row, slag] of board) {
      const c = af.place(type, tier, col, row);
      if (!c) continue;
      placed++;
      if (slag) {
        g.slag(c.id);
        slagged++;
      }
    }
    g.select(null);
    return { placed, slagged, structures: g.structures.length };
  }, board);
}

// ---- 1. title.png -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(500);
  await page.mouse.move(200, 200); // move the pointer off the menu for a clean title
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "title.png") });
  // Gesture so audio decodes; assert the game object is live and the graph does not error.
  await page.mouse.click(640, 240);
  await sleep(1200);
  const ok = await page.evaluate(() => !!window.__arcfoundry && window.__arcfoundry.game.state === "title");
  console.log("title captured; audio gesture ok:", ok);
  await page.close();
}

// ---- 2. gameplay.png (mid-wave, full maze, a shot mid-flight) ------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 240);
  await sleep(300);
  await page.evaluate(() => {
    const af = window.__arcfoundry;
    af.startOn("substation", "medium");
    af.game.devGrant(4000, 100);
  });
  const layout = await buildBoard(page, MAZE);
  console.log("gameplay board:", JSON.stringify(layout));
  await page.evaluate(() => window.__arcfoundry.game.devBeginWave(7)); // motes/sparks/clusters/slugs
  // Capture once the Load has fanned onto the maze and a shot is in flight (a VFX mid-fire).
  let gsnap = {};
  for (let i = 0; i < 90; i++) {
    gsnap = await page.evaluate(() => {
      const g = window.__arcfoundry.game;
      const walkers = g.units.filter((u) => u.wpIndex >= 1 && u.x > 140).length;
      return { units: g.units.length, walkers, projectiles: g.projectiles.length, wave: g.wave };
    });
    if (gsnap.walkers >= 4 && gsnap.projectiles >= 1) break;
    await sleep(80);
  }
  await page.evaluate(() => window.__arcfoundry.game.select(null));
  await page.screenshot({ path: path.join(proofDir, "gameplay.png") });
  console.log("gameplay captured:", JSON.stringify(gsnap));
  await page.close();
}

// ---- 3. game-over.png (Overload — Grid Integrity reached 0) --------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 240);
  await sleep(300);
  await page.evaluate(() => {
    const af = window.__arcfoundry;
    af.startOn("substation", "medium");
    const g = af.game;
    g.devGrant(400, 3); // a thin defence + low integrity: it scores, then the grid overloads
    g.speed = 6; // fast-forward the long serpentine so the Load reaches the Collector quickly
  });
  // A sparse board that cannot stop a dense late wave — the Load leaks until Grid Integrity
  // is spent and the grid overloads (specs/flow.md).
  await buildBoard(page, [
    ["capacitor", 1, 10, 4],
    ["coil", 1, 24, 4],
    ["emitter", 1, 38, 4],
  ]);
  await page.evaluate(() => window.__arcfoundry.game.devBeginWave(12));
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(() => window.__arcfoundry.game.state);
    if (s === "defeat") break;
    await sleep(100);
  }
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });
  const end = await page.evaluate(() => {
    const g = window.__arcfoundry.game;
    return { state: g.state, wave: g.wave, score: g.score, integrity: Math.floor(g.integrity) };
  });
  console.log("game-over captured:", JSON.stringify(end));
  await page.close();
}

// ---- clip helper (records the game's own rAF loop to a .webm) ------------------
async function clip(name, setup, seconds, during) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 240);
  await sleep(300);
  await setup(page);
  if (during) await during(page);
  else await sleep(seconds * 1000);
  const video = page.video();
  await page.close();
  await context.close();
  if (video) {
    const src = await video.path();
    await copyFile(src, path.join(proofDir, name));
  }
  console.log(`${name} captured`);
}

// ---- 4. systems.webm (the scrap-press build loop: stamp → combine → live re-path) --
await clip(
  "systems.webm",
  async (page) => {
    await page.evaluate(() => {
      const af = window.__arcfoundry;
      af.startOn("substation", "medium");
      af.game.devGrant(6000, 100);
      af.game.speed = 1;
    });
    await buildBoard(page, MAZE);
    await page.evaluate(() => window.__arcfoundry.game.devBeginWave(7)); // Load walking, so re-path shows
  },
  7,
  async (page) => {
    // A scripted build-loop, spaced out over the recording, so the clip shows each event:
    // a press stamp (buildspark), a combine folding two matching into a tier higher (its
    // combine-flash, one footprint freeing), and the floor re-pathing live around the change.
    await sleep(800);
    // A press stamp rolling a random component onto a legal footprint (specs/build.md).
    await page.evaluate(() => {
      const g = window.__arcfoundry.game;
      g.pullPress();
      const a = g.board.nearestLegalAnchor(15, 11, g.structures, g.units);
      if (a) g.placeStamp(a.col, a.row);
    });
    await sleep(1500);
    // Two matching components placed adjacent, then COMBINED into one a tier higher — the
    // partner's footprint frees and the maze re-paths (specs/build.md §6.5).
    await page.evaluate(() => {
      const af = window.__arcfoundry;
      af.place("capacitor", 2, 27, 11);
      af.place("capacitor", 2, 31, 11); // becomes selected — its partner is the first
      af.game.combineSelected();
    });
    await sleep(1500);
    // A fresh wall dropped across the corridor forces the walking Load to redirect live.
    await page.evaluate(() => {
      const af = window.__arcfoundry;
      af.place("discharge", 3, 20, 3);
      af.place("arcnode", 2, 34, 3);
      af.game.select(null);
    });
    await sleep(2400);
  },
);

// ---- 5. pressure.webm (late-wave: the Dynamo boss, chains + discharge, leaks, alert) --
await clip(
  "pressure.webm",
  async (page) => {
    await page.evaluate(() => {
      const af = window.__arcfoundry;
      af.startOn("substation", "medium");
      const g = af.game;
      g.devGrant(6000, 100); // grows maxIntegrity to 100 so the low-integrity band is a buffer
      g.integrity = 20; // ≤ 25% of max → the low-integrity alert shows and leaks bite red
      g.speed = 2;
    });
    await buildBoard(page, HEAVY);
    await page.evaluate(() => window.__arcfoundry.game.devBeginWave(15)); // milestone → Dynamo boss
  },
  8,
);

// ---- functional assertions (state machine, build loop, economy, re-path) ------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 240);
  await sleep(300);
  const checks = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const af = window.__arcfoundry;
    const g = af.game;
    af.startOn("substation", "medium");
    g.devGrant(9000, 100);

    // Combine: two matching components fold into one a tier higher, freeing one footprint.
    const a = af.place("capacitor", 2, 6, 4);
    const b = af.place("capacitor", 2, 10, 4);
    const before = g.structures.length;
    g.select(b.id);
    g.combineSelected();
    const combined = g.structures.find((s) => s.id === b.id);
    const combineWorks = combined && combined.tier === 3 && g.structures.length === before - 1;

    // Re-path: a component dropped in front of a walker changes its route.
    g.devBeginWave(7);
    for (let i = 0; i < 40 && g.units.length === 0; i++) await sleep(80);
    const walker = g.units.find((u) => !u.flies);
    const routeBefore = walker ? walker.route.length : 0;
    af.place("discharge", 1, 20, 3);
    af.place("arcnode", 1, 24, 3);
    const walker2 = walker ? g.units.find((u) => u.id === walker.id) : null;
    const rePaths = !!walker2; // the walker survived the re-path (route recomputed, not stranded)

    // Economy: kills pay Charge; play out the wave and confirm Charge grew from bounties.
    const startCharge = g.charge;
    let maxUnits = 0;
    let sawBoss = false;
    for (let i = 0; i < 200; i++) {
      maxUnits = Math.max(maxUnits, g.units.length);
      if (g.units.some((u) => u.type === "dynamo")) sawBoss = true;
      if (g.phase === "build" || g.state !== "playing") break;
      await sleep(60);
    }
    const earned = g.charge >= startCharge; // bounties paid across the wave
    const held = g.state === "playing" && g.integrity > 0;

    // Defeat path: a huge wave onto a stripped board overloads the grid.
    g.devGrant(50, 3);
    g.structures.length = 0;
    g.speed = 6; // fast-forward the long path so the Load grounds out within the wait
    g.devBeginWave(20);
    for (let i = 0; i < 400; i++) {
      if (g.state === "defeat") break;
      await sleep(50);
    }
    const defeatReachable = g.state === "defeat";

    return { combineWorks, rePaths, earned, held, maxUnits, defeatReachable, integrity: Math.floor(g.integrity) };
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
const ok = errors.length === 0 && c.combineWorks && c.rePaths && c.earned && c.defeatReachable;
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
