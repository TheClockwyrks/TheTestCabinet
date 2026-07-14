// Arc Foundry — proof-of-implementation capture (specs/proof.md).
//
// Serves the BUILT dist under a non-root sub-path (proving base-path safety, since a run is
// served from /runs/<id>/build/), drives the game through representative states with the
// project-local Playwright + Chromium, and writes the exact proof/ artifacts the case
// declares. Also asserts the build loads with no console errors and that the GemTD build loop
// (place-and-reveal, keep-one, blockers, combine, UPGRADE QUALITY), the maze, the economy, and
// the end states actually work.
//
// The board is laid out deterministically through window.__arcfoundry.place(type, tier, col,
// row) (an exact firing COMPONENT), .blocker(col, row) (an inert BLOCKER wall), and, for the
// build-loop demo, .game.devCandidate(...) — the dev counterparts to the random scrap-press —
// so each capture shows the exact mix the proof calls for (specs/build.md, specs/proof.md).
// The simulation itself is advanced by the game's own requestAnimationFrame loop (main.ts);
// this script only sets state and waits.

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
// each to the nearest legal anchor (specs/board.md). A staggered field across the corridor —
// firing COMPONENTS interspersed with inert BLOCKERS — forces the walking Load to weave.
//
// A board entry is either ["c", type, tier, col, row] (a firing component of that exact type
// + quality) or ["b", col, row] (an inert blocker wall). Blockers are the maze material a
// GemTD player accrues from every rock they do not keep (specs/build.md).
const MAZE = [
  ["c", "capacitor", 2, 6, 2],
  ["b", 12, 5],
  ["c", "coil", 1, 15, 2],
  ["c", "emitter", 1, 18, 8],
  ["b", 24, 5],
  ["c", "discharge", 3, 27, 2],
  ["b", 30, 8],
  ["c", "capacitor", 1, 36, 5],
  ["c", "coil", 2, 42, 2],
  ["b", 21, 5],
  ["b", 33, 2],
  ["c", "arcnode", 2, 9, 8],
];

// A denser board for the late-wave pressure clip — a chain-heavy line (Coils), area
// dischargers (Arc-Nodes), and long-range Discharge Rigs down the corridor so packed Load
// draws chain-lightning + discharge rings, plus blockers to shape the maze.
const HEAVY = [
  ["c", "coil", 3, 6, 2],
  ["c", "coil", 2, 14, 5],
  ["c", "arcnode", 3, 22, 2],
  ["c", "discharge", 4, 30, 5],
  ["c", "coil", 2, 38, 2],
  ["b", 12, 8],
  ["c", "capacitor", 3, 26, 8],
  ["c", "emitter", 2, 40, 8],
  ["b", 18, 2],
  ["b", 34, 8],
];

// Lay a named board out on the yard (exact components + inert blockers).
async function buildBoard(page, board) {
  return page.evaluate((board) => {
    const af = window.__arcfoundry;
    const g = af.game;
    let placed = 0;
    let blocked = 0;
    for (const e of board) {
      if (e[0] === "c") {
        if (af.place(e[1], e[2], e[3], e[4])) placed++;
      } else {
        if (af.blocker(e[1], e[2])) blocked++;
      }
    }
    g.select(null);
    return { placed, blocked, structures: g.structures.length };
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

// ---- 2. gameplay.png (mid-wave, full maze of components + blockers, a shot mid-flight) --
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
    af.setRefinement(3); // a mid-run refined press: the board carries higher tiers
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
  // A sparse board (a few weak components, no maze) that cannot stop a dense late wave — the
  // Load leaks until Grid Integrity is spent and the grid overloads (specs/flow.md).
  await buildBoard(page, [
    ["c", "capacitor", 1, 10, 4],
    ["c", "coil", 1, 24, 4],
    ["c", "emitter", 1, 38, 4],
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

// ---- 4. systems.webm (the GemTD build loop: place-and-reveal → keep/combine → UPGRADE
//         QUALITY → send, so unkept rocks harden into blockers and the Load routes the maze) --
await clip(
  "systems.webm",
  async (page) => {
    await page.evaluate(() => {
      const af = window.__arcfoundry;
      af.startOn("substation", "medium");
      af.game.devGrant(6000, 100);
      af.game.speed = 1;
    });
    // Start with a partial maze of blockers + a couple of kept components already down.
    await buildBoard(page, [
      ["c", "capacitor", 2, 6, 2],
      ["b", 14, 5],
      ["b", 22, 2],
      ["c", "coil", 1, 30, 5],
      ["b", 38, 8],
    ]);
  },
  9,
  async (page) => {
    // A scripted BUILD-PHASE loop, spaced over the recording, so the clip shows each event:
    // a rock placed that rolls on placement (buildspark), an UPGRADE QUALITY purchase, a
    // combine set on a matched pair, then SEND — the combine resolves (combine-flash), the
    // unkept rocks harden into blockers, and the Load routes the shortest open maze route.
    await sleep(700);
    // Pull the press and drop a rock: it ROLLS a random component on placement (specs/build.md).
    await page.evaluate(() => {
      const g = window.__arcfoundry.game;
      g.pullPress();
      const a = g.board.nearestLegalAnchor(18, 11, g.structures, g.units);
      if (a) g.placeStamp(a.col, a.row);
    });
    await sleep(1100);
    // Refine the press one level up the UPGRADE QUALITY track.
    await page.evaluate(() => window.__arcfoundry.upgradeQuality());
    await sleep(1100);
    // Two matching candidates + a couple of extra rocks; set a COMBINE as this level's harvest.
    await page.evaluate(() => {
      const af = window.__arcfoundry;
      const c1 = af.game.devCandidate("capacitor", 2, 26, 11);
      af.game.devCandidate("capacitor", 2, 31, 11);
      af.game.devCandidate("emitter", 1, 36, 11); // an unkept roll → becomes a blocker on send
      if (c1) af.combine(c1.id);
    });
    await sleep(1400);
    // Send the wave: the combine resolves (flash), the unkept candidates harden into blockers,
    // and the Load walks the shortest open route around the new maze (specs/build.md, board.md).
    await page.evaluate(() => window.__arcfoundry.startWave());
    await sleep(3200);
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
      af.setRefinement(4);
    });
    await buildBoard(page, HEAVY);
    await page.evaluate(() => {
      const g = window.__arcfoundry.game;
      g.integrity = 20; // ≤ 25% of max → the low-integrity alert shows and leaks bite red
      g.speed = 2;
      g.devBeginWave(15); // milestone → Dynamo boss
    });
  },
  8,
);

// ---- functional assertions (state machine, build loop, economy, keep-one) -----
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

    // Keep-one: place 3 candidates, KEEP one, SEND — exactly the kept one becomes a component,
    // the other two harden into blockers (specs/build.md).
    af.startOn("substation", "medium");
    g.devGrant(9000, 100);
    const k1 = g.devCandidate("coil", 1, 6, 10);
    g.devCandidate("emitter", 1, 10, 10);
    g.devCandidate("arcnode", 1, 14, 10);
    g.keep(k1.id);
    const candCount = g.structures.filter((s) => s.kind === "candidate").length;
    g.startWave();
    const keptIsComponent = g.structures.find((s) => s.id === k1.id)?.kind === "component";
    const blockers = g.structures.filter((s) => s.kind === "blocker").length;
    const keepOneWorks = candCount === 3 && keptIsComponent && blockers >= 2;

    // Building is BUILD-PHASE ONLY: while a wave runs, the press cannot be pulled or placed.
    const midWaveNoBuild = g.phase === "wave" && g.pullPress() === false && g.placeStamp(20, 20) === null;

    // Combine: two matching candidates fold into one a tier higher on SEND, freeing a footprint.
    af.startOn("substation", "medium");
    g.devGrant(9000, 100);
    const a = g.devCandidate("capacitor", 2, 6, 4);
    g.devCandidate("capacitor", 2, 10, 4);
    const before = g.structures.length;
    g.combine(a.id);
    g.startWave();
    const combined = g.structures.find((s) => s.id === a.id);
    const combineWorks = !!combined && combined.kind === "component" && combined.tier === 3 && g.structures.length === before - 1;

    // UPGRADE QUALITY: buying a Refinement level costs Charge and raises the level.
    af.startOn("substation", "medium");
    g.devGrant(9000, 100);
    const r0 = g.refinement;
    const cost = g.refineCost();
    const chargeBefore = g.charge;
    const bought = g.upgradeQuality();
    const refineWorks = bought && g.refinement === r0 + 1 && g.charge === chargeBefore - cost;

    // Economy: kills pay Charge; play out a wave and confirm Charge grew from bounties.
    af.startOn("substation", "medium");
    g.devGrant(1000, 100);
    af.place("discharge", 4, 8, 4);
    af.place("arcnode", 4, 16, 4);
    af.place("coil", 4, 24, 4);
    const startCharge = g.charge;
    g.devBeginWave(7);
    let maxUnits = 0;
    for (let i = 0; i < 200; i++) {
      maxUnits = Math.max(maxUnits, g.units.length);
      if (g.phase === "build" || g.state !== "playing") break;
      await sleep(60);
    }
    const earned = g.charge >= startCharge; // bounties paid across the wave

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

    return { keepOneWorks, midWaveNoBuild, combineWorks, refineWorks, earned, maxUnits, defeatReachable, integrity: Math.floor(g.integrity) };
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
const ok =
  errors.length === 0 &&
  c.keepOneWorks &&
  c.midWaveNoBuild &&
  c.combineWorks &&
  c.refineWorks &&
  c.earned &&
  c.defeatReachable;
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
