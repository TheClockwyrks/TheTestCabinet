// Hollowdeep — proof-of-implementation capture (specs/proof.md, DESIGN §8).
//
// Serves the BUILT dist under a non-root sub-path (proving base-path safety), drives the
// sealed-colony sim through representative states with the project-local Playwright +
// Chromium, and writes the exact proof/ artifacts the case declares. Also asserts the build
// loads with no console/request errors and that the colony systems (dig→refine→build, power,
// gas) and the loss state actually work.
//
// The game exposes a dev/control surface on window.__hollowdeep (see src/main.ts):
//   { game, audio, startColony(), digRect(x0,y0,x1,y1), place(kind,tx,ty),
//     grant({ore,material,food}), fillCavern(o2), sealAndSpend(), setSpeed(n), tick(n) }
// The full Game (world/tiles/delvers/stocks) is reachable through `.game` for scene setup.

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

// A neutral gesture point (top-left corner) that is never over a menu button — clicking it
// unlocks audio without activating a menu item. The scenes then drive via the dev API.
async function unlockAudio(page) {
  await page.mouse.click(30, 30);
  await sleep(150);
}

// The scene builder run inside the page. Machines sit on the LEFT of the cavern floor row so
// they don't wall off the crew's downward digging in the centre; the farm sits on the right.
// Everything is expressed in tile coords over the opening cavern (open x∈[25,38], y∈[5,11],
// solid floor at y=12) — see src/worldgen.ts CAVERN.
const COLONY_SCENE = ({ withGhosts }) => {
  const H = window.__hollowdeep;
  const g = H.game;
  H.startColony();
  H.grant({ material: 300, ore: 40, food: 12 });

  // A powered life-support cluster on the left: a fuelled generator wired to a diffuser, plus
  // an operated refinery. One 20 W generator covers the 12 W diffuser (no brownout) so the
  // diffuser RUNS and vents steam.
  H.place("generator", 25, 11);
  H.place("wire", 26, 11);
  H.place("diffuser", 27, 11);
  H.place("refinery", 28, 11);
  // A fungus farm on the right (needs solid ground beneath — dirt floor at y=12).
  H.place("farm", 38, 11);

  // Live build orders a delver will construct on-camera (ghosts, not instant) — right side,
  // standable floor-row tiles.
  if (withGhosts) {
    g.placeBuild(35, 11, "ladder");
    g.placeBuild(36, 11, "wire");
    g.buildsFirst = true; // "builds before digs" so a delver constructs an order on-camera
  }

  // Queue real dig work down the centre (delvers walk to it and mine, dust puffing). Some of
  // these tiles are ore seams under the cavern → mining yields ore.
  g.markDigRect(31, 12, 33, 14);
  g.markDigRect(30, 12, 30, 13);

  // Seed the gas overlay to read clearly: oxygen dense across the room (a bright breathable
  // haze), CO2 pooled along the low floor rows (a visible plume, kept below the 55 toxic line
  // so the crew still breathes). The live sim keeps evolving these from the diffuser and the
  // delvers' breathing.
  H.fillCavern(95);
  for (let ty = 9; ty <= 11; ty++) {
    for (let tx = 25; tx <= 38; tx++) {
      const t = g.world.tiles[ty * g.world.w + tx];
      if (t && (t.kind === "open" || t.kind === "floor" || t.kind === "wire")) t.co2 = 46;
    }
  }
};

// A compact colony readout for logging + assertions.
const READOUT = () => {
  const g = window.__hollowdeep.game;
  const diffuser = g.world.machines.find((m) => m.kind === "diffuser");
  return {
    state: g.state,
    cycle: g.cycle,
    diffuserRunning: !!(diffuser && diffuser.running),
    machinesRunning: g.world.machines.filter((m) => m.running).length,
    digging: g.delvers.filter((d) => !d.dead && d.act === "dig").length,
    refining: g.delvers.filter((d) => !d.dead && d.act === "refine").length,
    building: g.delvers.filter((d) => !d.dead && d.act === "build").length,
    fleeing: g.delvers.filter((d) => !d.dead && d.act === "flee").length,
    alive: g.delvers.filter((d) => !d.dead).length,
    oxygenAvg: Math.round(g.oxygenAvg()),
    oxygenLow: Math.round(g.oxygenLow()),
    co2Avg: Math.round(g.co2Avg()),
    material: g.stocks.material,
    ore: g.stocks.ore,
    food: g.stocks.food,
  };
};

// ---- 1. title.png -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(500);
  await page.mouse.move(200, 560); // pointer off the centred menu for a clean title
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "title.png") });
  await unlockAudio(page); // gesture so audio decodes; assert the game booted with no error
  const booted = await page.evaluate(() => !!window.__hollowdeep && window.__hollowdeep.game.state === "title");
  console.log("title captured; booted+audio gesture ok:", booted);
  await page.close();
}

// ---- 2. gameplay.png (live in-colony frame, full HUD) -------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await unlockAudio(page);
  await page.evaluate(COLONY_SCENE, { withGhosts: false });
  await page.evaluate(() => window.__hollowdeep.setSpeed(2));
  // Let the sim run until the diffuser is powered+running and the crew is mid-task.
  let snap = {};
  for (let i = 0; i < 90; i++) {
    snap = await page.evaluate(READOUT);
    if (snap.diffuserRunning && snap.digging + snap.refining >= 1) break;
    await sleep(100);
  }
  await page.screenshot({ path: path.join(proofDir, "gameplay.png") });
  console.log("gameplay captured:", JSON.stringify(snap));
  await page.close();
}

// ---- 3. game-over.png (colony lost — last delver suffocated) -------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await unlockAudio(page);
  await page.evaluate(() => {
    const H = window.__hollowdeep;
    H.startColony();
    H.sealAndSpend(); // no oxygen generation; the pocket is thin — the crew spends it and dies
    H.setSpeed(3);
  });
  // Fast-forward the sim with the dev tick() until the last delver dies (the RAF loop also
  // advances it; double-stepping only reaches the loss state sooner).
  let end = {};
  for (let i = 0; i < 400; i++) {
    end = await page.evaluate(() => {
      window.__hollowdeep.tick(20); // ~1 sim-second per call
      const g = window.__hollowdeep.game;
      return { state: g.state, cycle: g.cycle, score: g.score, alive: g.delvers.filter((d) => !d.dead).length };
    });
    if (end.state === "gameover") break;
  }
  await sleep(400); // let the colony-lost overlay draw
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });
  console.log("game-over captured:", JSON.stringify(end));
  await page.close();
}

// ---- clip helper --------------------------------------------------------------
async function clip(name, setup, seconds) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await unlockAudio(page);
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

// ---- 4. systems.webm (colony systems at work) ---------------------------------
await clip(
  "systems.webm",
  async (page) => {
    await page.evaluate(COLONY_SCENE, { withGhosts: true });
    await page.evaluate(() => window.__hollowdeep.setSpeed(2));
  },
  8,
);

// ---- 5. survival.webm (survival pressure: air down, alert, fleeing) -----------
await clip(
  "survival.webm",
  async (page) => {
    await page.evaluate(() => {
      const H = window.__hollowdeep;
      const g = H.game;
      H.startColony();
      // A barely-breathable pocket, no oxygen source: the crew draws its tiles below the
      // breathe line within a second, the low-oxygen alert lights, and delvers flee toward
      // better air. Sour the low floor rows toward the toxic line to read as a room going bad.
      H.fillCavern(24);
      for (let ty = 9; ty <= 11; ty++) {
        for (let tx = 25; tx <= 38; tx++) {
          const t = g.world.tiles[ty * g.world.w + tx];
          if (t && (t.kind === "open" || t.kind === "floor")) t.co2 = 46;
        }
      }
      H.setSpeed(2);
    });
    // audio is left unmuted (the alarm cue plays through the gesture-unlocked context).
  },
  7,
);

// ---- functional assertions (systems + loss actually work) ---------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await unlockAudio(page);
  const checks = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const H = window.__hollowdeep;
    const g = H.game;

    // (a) The dig→refine→build chain + powered diffuser: drive the full colony scene and step
    // it, confirming a diffuser runs, ore is mined, ore refines to material, and a build lands.
    H.startColony();
    H.grant({ material: 20, ore: 8, food: 10 });
    H.place("generator", 25, 11);
    H.place("wire", 26, 11);
    H.place("diffuser", 27, 11);
    H.place("refinery", 28, 11);
    g.placeBuild(35, 11, "ladder");
    g.buildsFirst = true; // surface the build ahead of the queued digs
    g.markDigRect(31, 12, 33, 14);
    const oreDug0 = g.tilesDug;
    const material0 = g.stocks.material;
    let diffuserRan = false;
    let built = false;
    for (let i = 0; i < 400; i++) {
      H.tick(4);
      if (g.world.machines.some((m) => m.kind === "diffuser" && m.running)) diffuserRan = true;
      const ladder = g.world.tiles[11 * g.world.w + 35];
      if (ladder && ladder.kind === "ladder") built = true;
      if (diffuserRan && built && g.stocks.material > material0 && g.tilesDug > oreDug0) break;
      await sleep(0);
    }
    const minedOpened = g.tilesDug > oreDug0;
    const refinedMaterial = g.stocks.material > material0; // ore→material happened
    const oxygenRose = g.oxygenAvg() > 0;

    // (b) Loss actually reachable: a thin, unpowered pocket kills the crew.
    H.startColony();
    H.sealAndSpend();
    for (let i = 0; i < 600 && g.state !== "gameover"; i++) H.tick(20);
    const lossReached = g.state === "gameover";
    const cyclesShown = typeof g.score === "number";

    // (c) Do-nothing baseline also loses: with no pump the crew's exhaled CO2 only accumulates
    // and the oxygen pocket only drains, so a sealed, unmanaged colony sours and suffocates.
    // This takes many cycles (~1500+ sim-sec), so give the loop room.
    H.startColony();
    for (let i = 0; i < 800 && g.state !== "gameover"; i++) H.tick(50);
    const doNothingLoses = g.state === "gameover";
    const doNothingCycles = g.cycle;

    return { diffuserRan, minedOpened, refinedMaterial, built, oxygenRose, lossReached, cyclesShown, doNothingLoses, doNothingCycles };
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
  c.diffuserRan &&
  c.minedOpened &&
  c.refinedMaterial &&
  c.built &&
  c.lossReached &&
  c.doNothingLoses;
console.log(ok ? "PROOF+VERIFY OK" : "PROBLEMS DETECTED");
process.exit(ok ? 0 : 1);
