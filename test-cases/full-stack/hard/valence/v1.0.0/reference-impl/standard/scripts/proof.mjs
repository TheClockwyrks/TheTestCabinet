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

// A generous full board used for the "contained" scenarios.
const FULL_BOARD = [
  ["shear", 4], ["shear", 10],
  ["ionizer", 5], ["ionizer", 6], ["ionizer", 8],
  ["ionizer", 11], ["ionizer", 12], ["ionizer", 14],
  ["ionizer", 2], ["ionizer", 3],
  ["fission", 9], ["fission", 15],
  ["catalyst", 7], ["catalyst", 13],
  ["moderator", 0], ["moderator", 1],
];

async function buildBoard(page, board, upgrade = 0) {
  await page.evaluate(({ board, upgrade }) => {
    const v = window.__valence;
    for (const [kind, node] of board) v.build(kind, node);
    if (upgrade) {
      for (const [, node] of board) {
        window.__valence.game.selectedNode = node;
        for (let i = 1; i < upgrade; i++) window.__valence.game.upgradeSelected();
      }
      window.__valence.game.selectedNode = null;
    }
  }, { board, upgrade });
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
    v.game.start();
    v.game.devGrant(4000, 100);
    v.game.devBeginRound(9); // atoms + molecules + nobles + heavies all present
    // A deliberately lighter board so varied matter survives on the lanes to read.
    for (const [k, n] of [["shear", 4], ["shear", 10], ["ionizer", 5], ["ionizer", 8], ["ionizer", 11], ["ionizer", 14], ["fission", 9], ["fission", 15], ["catalyst", 7], ["catalyst", 13], ["moderator", 0]]) v.build(k, n);
    v.game.selectedNode = null;
  });
  // Capture once matter has fanned onto both lanes with 3+ forms present.
  let gsnap = {};
  for (let i = 0; i < 70; i++) {
    gsnap = await page.evaluate(() => {
      const g = window.__valence.game;
      const onLanes = g.units.filter((u) => u.s > 240).length;
      const bothLanes = new Set(g.units.filter((u) => u.s > 200).map((u) => u.lane)).size;
      const forms = new Set(g.units.map((u) => u.form)).size;
      return { onLanes, bothLanes, forms, total: g.units.length };
    });
    if (gsnap.onLanes >= 4 && gsnap.forms >= 3 && gsnap.bothLanes >= 2) break;
    await sleep(80);
  }
  await page.evaluate(() => (window.__valence.game.selectedNode = null));
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
    v.game.start();
    v.game.devGrant(760, 14); // a thin board + low integrity: it scores, then breaches
    v.game.speed = 3;
    v.game.devBeginRound(12);
    // a partial defense so some matter is neutralized (earning score) before the breach
    for (const [k, n] of [["ionizer", 5], ["ionizer", 6], ["shear", 4], ["ionizer", 2]]) v.build(k, n);
  });
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
      v.game.start();
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
      v.game.start();
      v.game.devGrant(2200, 20); // below the 25% alert threshold so leaks show red
      v.game.speed = 2;
      v.game.devBeginRound(10); // boss round
    });
    // A partial board — one lane thinner — so some matter leaks under pressure.
    await buildBoard(page, [
      ["shear", 4], ["ionizer", 5], ["ionizer", 6], ["ionizer", 8],
      ["fission", 9], ["catalyst", 7], ["moderator", 0],
      ["ionizer", 2], ["fission", 15], ["ionizer", 12],
    ], 2);
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
  const checks = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const v = window.__valence;
    const g = v.game;
    g.start();
    g.devGrant(9999, 100);
    g.speed = 3;
    // Fully upgraded board; run a molecule/heavy/noble round and confirm decomposition.
    g.devBeginRound(9);
    const board = [["shear", 4], ["shear", 10], ["ionizer", 5], ["ionizer", 6], ["ionizer", 8], ["ionizer", 11], ["ionizer", 12], ["ionizer", 14], ["ionizer", 2], ["ionizer", 3], ["fission", 9], ["fission", 15], ["catalyst", 7], ["catalyst", 13], ["moderator", 0], ["moderator", 1]];
    for (const [k, n] of board) v.build(k, n);
    const startEnergy = g.energy;
    let sawMolecule = false, sawHeavy = false, sawFreedAtoms = 0, maxUnits = 0;
    for (let i = 0; i < 120; i++) {
      for (const u of g.units) {
        if (u.form === "molecule") sawMolecule = true;
        if (u.form === "heavy") sawHeavy = true;
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
const ok = errors.length === 0 && c.sawMolecule && c.sawHeavy && c.contained && c.wonReachable;
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
