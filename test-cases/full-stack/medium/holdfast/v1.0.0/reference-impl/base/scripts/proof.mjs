// Holdfast — proof-of-implementation capture (specs/proof.md, DESIGN §9).
//
// Serves the BUILT dist under a non-root sub-path (proving base-path safety), drives the
// colony through representative states with the project-local Playwright + Chromium via the
// window.__holdfast hooks, and writes the exact proof/ artifacts the case declares:
//   proof/title.png · proof/gameplay.png · proof/game-over.png
//   proof/colony.webm (the everyday economy) · proof/raid.webm (a night raid)
// It also asserts the build loads and runs with zero console errors.

import { chromium } from "playwright";
import http from "node:http";
import { execSync } from "node:child_process";
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

// Build the site if it has not been built yet (the artifacts are captured from the build).
if (!existsSync(path.join(dist, "index.html"))) {
  console.log("dist/ missing — building…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mid": "audio/midi",
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

// A neutral gesture (off any menu item) so Web Audio may unlock without navigating.
async function gesture(page) {
  await page.mouse.click(640, 120);
  await sleep(120);
}

// ---- Shared in-page setup snippets (run in the browser via page.evaluate) ------

// Set up a working "New Colony" the way the gameplay/economy captures want it: a designated
// chop + mine on the nearest stands, a small built colony (turret, stove, farm, a wall run),
// and a modest stock. Returns a summary for logging.
function colonyScene() {
  const h = window.__holdfast;
  const g = h.game;
  h.startBase();
  h.grant("wood", 400);
  h.grant("ore", 220);
  h.grant("crops", 16);
  const l = g.world.landing;
  const near = (kind) => {
    let best = null;
    let bd = 1e9;
    for (const t of g.world.tiles) {
      if (t.node && t.node.kind === kind) {
        const d = Math.abs(t.x - l.tx) + Math.abs(t.y - l.ty);
        if (d < bd) {
          bd = d;
          best = { tx: t.x, ty: t.y };
        }
      }
    }
    return best;
  };
  const tree = near("tree");
  const ore = near("ore");
  if (tree) h.designate("chop", tree.tx - 1, tree.ty - 1, tree.tx + 1, tree.ty + 1);
  if (ore) h.designate("mine", ore.tx - 1, ore.ty - 1, ore.tx + 1, ore.ty + 1);
  h.build("turret", l.tx - 2, l.ty - 2);
  h.build("stove", l.tx + 2, l.ty - 2);
  h.build("farm", l.tx + 2, l.ty + 2);
  for (let dx = -2; dx <= 2; dx++) h.build("wall", l.tx + dx, l.ty + 3);
  g.speed = 3;
  return { tree, ore, structures: g.structures.length };
}

// ---- 1. title.png -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(500);
  await page.mouse.move(400, 400); // pointer off the menu for a clean title frame
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "title.png") });
  const ready = await page.evaluate(() => !!window.__holdfast && window.__holdfast.game.state);
  console.log("title captured; hooks ready:", ready);
  await page.close();
}

// ---- 2. gameplay.png (a live in-colony frame with the full HUD) ----------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await gesture(page);
  const setup = await page.evaluate(colonyScene);
  await sleep(4500); // let the live loop animate: settlers walk out, work, dust, food cooks
  await page.evaluate(() => window.__holdfast.camTo(window.__holdfast.game.world.landing.tx, window.__holdfast.game.world.landing.ty));
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "gameplay.png") });
  const snap = await page.evaluate(() => {
    const g = window.__holdfast.game;
    return {
      state: g.state,
      day: g.day,
      settlers: g.livingSettlers().length,
      structures: g.structures.length,
      drops: g.drops.length,
      activities: g.settlers.map((s) => s.activity),
      stock: g.stock,
    };
  });
  console.log("gameplay setup:", JSON.stringify(setup), "→", JSON.stringify(snap));
  await page.close();
}

// ---- 3. game-over.png (colony lost — days survived shown) ----------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await gesture(page);
  await page.evaluate(() => {
    const h = window.__holdfast;
    const g = h.game;
    h.startBase();
    h.grant("wood", 300);
    h.grant("ore", 200);
    h.grant("meals", 30); // don't let them simply starve during the fast-forward
    const l = g.world.landing;
    h.build("turret", l.tx - 1, l.ty - 2);
    for (let dx = -1; dx <= 1; dx++) h.build("wall", l.tx + dx, l.ty - 3);
    h.advance(300); // ~3.3 days of real simulation (raids, needs, mood, milestones)
    h.killAll(); // the last settler falls → the colony is lost
  });
  await sleep(400);
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });
  const end = await page.evaluate(() => ({ state: window.__holdfast.game.state, score: window.__holdfast.game.score }));
  console.log("game-over captured:", JSON.stringify(end));
  await page.close();
}

// ---- clip helper (records a native .webm via recordVideo) ----------------------
async function clip(name, setup, seconds) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await gesture(page);
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

// ---- 4. colony.webm (the everyday economy: gather → haul → build → cook) --------
await clip(
  "colony.webm",
  async (page) => {
    await page.evaluate(() => {
      const h = window.__holdfast;
      const g = h.game;
      h.startBase();
      h.grant("wood", 160);
      h.grant("ore", 80);
      h.grant("crops", 12); // enough for the stove to cook meals
      const l = g.world.landing;
      const near = (kind) => {
        let best = null;
        let bd = 1e9;
        for (const t of g.world.tiles) {
          if (t.node && t.node.kind === kind) {
            const d = Math.abs(t.x - l.tx) + Math.abs(t.y - l.ty);
            if (d < bd) {
              bd = d;
              best = { tx: t.x, ty: t.y };
            }
          }
        }
        return best;
      };
      const tree = near("tree");
      const ore = near("ore");
      if (tree) h.designate("chop", tree.tx - 1, tree.ty - 1, tree.tx + 1, tree.ty + 1);
      if (ore) h.designate("mine", ore.tx - 1, ore.ty - 1, ore.tx + 1, ore.ty + 1);
      // A couple of build orders so hauled material is consumed into finished structures.
      g.placeGhost("wall", l.tx - 3, l.ty);
      g.placeGhost("wall", l.tx - 3, l.ty + 1);
      // A working stove turns the crops into meals — the food chain running.
      h.build("stove", l.tx + 2, l.ty - 2);
      g.speed = 3;
    });
  },
  7,
);

// ---- 5. raid.webm (a night raid: warning, fire, cover, downed) ------------------
await clip(
  "raid.webm",
  async (page) => {
    await page.evaluate(() => {
      const h = window.__holdfast;
      const g = h.game;
      h.startBase();
      h.grant("wood", 400);
      h.grant("ore", 250);
      const l = g.world.landing;
      // A fire-covered wall line the raiders cannot break, with a turret posted behind it.
      for (let dx = -2; dx <= 2; dx++) h.build("wall", l.tx + dx, l.ty - 4);
      h.build("turret", l.tx, l.ty - 2);
      h.forcePhase("night");
      h.triggerRaid(6); // spawn the wave now (alarm cue + the RAID banner)
      h.advance(8); // close the distance so the recorded clip opens on an active firefight
      g.fxQueue.length = 0; // drop the fast-forward's fx backlog (don't dump it in one frame)
      g.sndQueue.length = 0;
      g.speed = 3;
    });
  },
  8,
);

// ---- report -------------------------------------------------------------------
console.log("---");
console.log("console errors across all pages:", errors.length);
for (const e of errors.slice(0, 25)) console.log("  -", e);

await browser.close();
server.close();

const required = ["title.png", "gameplay.png", "game-over.png", "colony.webm", "raid.webm"];
const missing = required.filter((f) => !existsSync(path.join(proofDir, f)));
console.log("proof files:", required.map((f) => `${f}=${existsSync(path.join(proofDir, f)) ? "ok" : "MISSING"}`).join("  "));

const ok = errors.length === 0 && missing.length === 0;
console.log(ok ? "PROOF OK" : "PROBLEMS DETECTED");
if (missing.length) console.log("missing:", missing.join(", "));
process.exit(ok ? 0 : 1);
