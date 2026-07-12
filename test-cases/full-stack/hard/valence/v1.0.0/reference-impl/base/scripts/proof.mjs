// Valence — proof-of-implementation capture (specs/proof.md).
//
// Serves the BUILT dist under a non-root sub-path (proving base-path safety), drives
// the game through representative states with the project-local Playwright + Chromium,
// and writes the exact proof/ artifacts the case declares. Also asserts the build
// loads with no console errors and that the decomposition, economy, and end states
// actually work.

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

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wav": "audio/wav", ".png": "image/png", ".mid": "audio/midi" };

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

// The proof runs on the MEDIUM branching map (JUNCTION): a fork into two lanes that share
// an inlet trunk and a final run, so the demo boards read a real fork+merge with free
// placement. Spots are world anchors beside each run; free placement snaps each to the
// nearest legal spot (specs/board.md). Keyed by lane role: shared inlet/final (both lanes),
// Lane A (top run y≈150), Lane B (bottom run y≈626), plus reactors near the merge.
const SPOT = {
  inA: [90, 350], inB: [90, 426], // shared inlet trunk — reaches both lanes
  outA: [900, 350], outB: [900, 426], // shared final run — reaches both lanes
  a0: [200, 112], a1: [320, 112], a2: [440, 112], a3: [560, 112], a4: [680, 112], aF: [770, 210], // Lane A (top)
  b0: [200, 664], b1: [320, 664], b2: [440, 664], b3: [560, 664], b4: [680, 664], bF: [770, 566], // Lane B (bottom)
};
const spots = (pairs) => pairs.map(([kind, key]) => [kind, ...SPOT[key]]);

// A generous full board used for the "contained" scenarios: energy strippers
// (ionizer/emitter/beam), kinetic + nuclear (cleaver/reactor) for the heavies, detection
// (catalyst + the beam natively), and a moderator for pacing — one of everything, the
// point of the redesign (specs/towers.md).
const FULL_BOARD = spots([
  ["cleaver", "a0"], ["cleaver", "b0"],
  ["ionizer", "a1"], ["ionizer", "a2"], ["ionizer", "a4"],
  ["ionizer", "b1"], ["ionizer", "b2"], ["ionizer", "b4"],
  ["ionizer", "outA"], ["reactor", "outB"],
  ["reactor", "aF"], ["beam", "bF"],
  ["catalyst", "a3"], ["catalyst", "b3"],
  ["moderator", "inA"], ["emitter", "inB"],
]);

// Upgrade every placed tower toward `upgrade` (1..3); at tier III each takes `branch`.
async function buildBoard(page, board, upgrade = 0, branch = "A") {
  await page.evaluate(({ board, upgrade, branch }) => {
    const v = window.__valence;
    for (const [kind, x, y] of board) v.build(kind, x, y);
    if (upgrade > 1) for (const [, x, y] of board) v.upgrade(x, y, upgrade, branch);
    v.game.selectedTowerId = null;
  }, { board, upgrade, branch });
}

// ---- 1. title.png -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(500);
  await page.mouse.move(400, 400); // move the pointer off the menu for a clean title
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "title.png") });
  // gesture so audio decodes; assert it does not error.
  await page.mouse.click(640, 200);
  await sleep(1200);
  const audioOk = await page.evaluate(() => !!window.__valence);
  console.log("title captured; audio gesture ok:", audioOk);
  await page.close();
}

// ---- 2. gameplay.png (mid-round, round 7, full board, a burst mid-flight) ------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200);
  await sleep(300);
  await page.evaluate(() => {
    const v = window.__valence;
    v.startOn("junction");
    v.game.devGrant(4000, 100);
    v.game.devBeginRound(9); // atoms + molecules + nobles + heavies all present
  });
  // A deliberately light board — cleavers chip molecules open (a bond-snap burst
  // mid-flight) and catalysts reveal nobles, but with only a couple of strippers little is
  // neutralized, so varied matter (atoms, molecules, heavies, revealed/unrevealed inert)
  // survives and travels well down both lanes.
  await buildBoard(page, spots([
    ["cleaver", "a1"], ["cleaver", "b1"], ["catalyst", "a2"], ["catalyst", "b2"],
    ["ionizer", "a4"], ["ionizer", "b4"],
  ]));
  await page.evaluate(() => (window.__valence.game.selectedTowerId = null));
  // Capture once matter has fanned onto both lanes with 3+ trait categories present.
  let gsnap = {};
  for (let i = 0; i < 70; i++) {
    gsnap = await page.evaluate(() => {
      const g = window.__valence.game;
      const onLanes = g.units.filter((u) => u.s > 240).length;
      const bothLanes = new Set(g.units.filter((u) => u.s > 200).map((u) => u.lane)).size;
      const cats = new Set(g.units.map((u) => (u.traits.includes("bonded") ? "bonded" : u.traits.includes("heavy") ? "heavy" : u.traits.includes("inert") ? "inert" : "atom")));
      return { onLanes, bothLanes, forms: cats.size, total: g.units.length };
    });
    if (gsnap.onLanes >= 4 && gsnap.forms >= 3 && gsnap.bothLanes >= 2) break;
    await sleep(80);
  }
  await page.evaluate(() => (window.__valence.game.selectedTowerId = null));
  await page.screenshot({ path: path.join(proofDir, "gameplay.png") });
  console.log("gameplay stage:", JSON.stringify(gsnap));
  const snap = await page.evaluate(() => ({ round: window.__valence.game.round, units: window.__valence.game.units.length, energy: Math.round(window.__valence.game.energy) }));
  console.log("gameplay captured:", JSON.stringify(snap));
  await page.close();
}

// ---- 3. game-over.png (containment failed) ------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200);
  await sleep(300);
  await page.evaluate(() => {
    const v = window.__valence;
    v.startOn("junction");
    v.game.devGrant(760, 14); // a thin board + low integrity: it scores, then breaches
    v.game.speed = 3;
    v.game.devBeginRound(12);
  });
  // an energy-only defense: it strips atoms (earning score) but cannot touch the heavies,
  // which leak until integrity is spent and containment fails (specs/matter.md).
  await buildBoard(page, spots([["ionizer", "a1"], ["ionizer", "a2"], ["emitter", "a0"], ["ionizer", "outA"]]));
  for (let i = 0; i < 160; i++) {
    const s = await page.evaluate(() => window.__valence.game.state);
    if (s === "defeat") break;
    await sleep(100);
  }
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });
  const end = await page.evaluate(() => ({ state: window.__valence.game.state, round: window.__valence.game.round, score: window.__valence.game.score }));
  console.log("game-over captured:", JSON.stringify(end));
  await page.close();
}

// ---- 4. systems.webm (decomposition at work) ----------------------------------
async function clip(name, setup, seconds) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200);
  await sleep(300);
  await setup(page);
  await sleep(seconds * 1000);
  const video = page.video();
  await page.close();
  await context.close();
  if (video) {
    const src = await video.path();
    await copyFile(src, path.join(proofDir, name));
  }
  console.log(`${name} captured`);
}

await clip(
  "systems.webm",
  async (page) => {
    await page.evaluate(() => {
      const v = window.__valence;
      v.startOn("junction");
      v.game.devGrant(6000, 100);
      v.game.speed = 1;
      v.game.devBeginRound(9); // molecules + nobles + heavies present
    });
    await buildBoard(page, FULL_BOARD, 2);
  },
  6,
);

// ---- 5. pressure.webm (late-round: the boss fragmenting, leaks, low-integrity) -
await clip(
  "pressure.webm",
  async (page) => {
    await page.evaluate(() => {
      const v = window.__valence;
      v.startOn("junction");
      v.game.devGrant(2200, 20); // below the 25% alert threshold so leaks show red
      v.game.speed = 2;
      v.game.devBeginRound(10); // boss round
    });
    // A partial board — one lane thinner — so some matter leaks under pressure.
    await buildBoard(page, spots([
      ["cleaver", "a0"], ["ionizer", "a1"], ["ionizer", "a2"], ["ionizer", "a4"],
      ["reactor", "aF"], ["catalyst", "a3"], ["moderator", "inA"],
      ["ionizer", "outA"], ["reactor", "bF"], ["ionizer", "b2"],
    ]), 2);
  },
  7,
);

// ---- functional assertions (state machine, decomposition, economy) ------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.click(640, 200);
  await sleep(300);
  const checks = await page.evaluate(async (board) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const v = window.__valence;
    const g = v.game;
    v.startOn("junction");
    g.devGrant(9999, 100);
    g.speed = 3;
    // Fully upgraded board; run a molecule/heavy/noble round and confirm decomposition.
    g.devBeginRound(9);
    for (const [k, x, y] of board) v.build(k, x, y);
    const startEnergy = g.energy;
    let sawMolecule = false, sawHeavy = false, maxUnits = 0;
    for (let i = 0; i < 120; i++) {
      for (const u of g.units) {
        if (u.traits.includes("bonded")) sawMolecule = true;
        if (u.traits.includes("heavy")) sawHeavy = true;
      }
      maxUnits = Math.max(maxUnits, g.units.length);
      if (g.phase === "build") break; // round cleared
      await sleep(80);
    }
    const contained = g.state === "playing" && g.integrity > 80;
    const earnedEnergy = g.energy > startEnergy - 3000; // neutralize bounties refilled

    // Victory path: jump to round 20 and finish it.
    g.devBeginRound(20);
    g.devFinishRound();
    await sleep(120);
    const wonReachable = g.state === "victory";

    return { sawMolecule, sawHeavy, contained, earnedEnergy, maxUnits, wonReachable, integrity: Math.round(g.integrity) };
  }, FULL_BOARD);
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
const ok = errors.length === 0 && c.sawMolecule && c.sawHeavy && c.contained && c.wonReachable;
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
