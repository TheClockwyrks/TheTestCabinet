// Arc Foundry — capture the showcase media (specs/showcase.md).
//
// Serves the production build, drives it in Chromium exactly as a player would — the menus
// through their own choices, the yard through the press and the harvest — and records the
// screen to `showcase/`. Every act here is an act a player performs: the driver arranges the
// input and lets the game produce the outcome.
//
// Usage:  npm run build && node scripts/capture-showcase.mjs
//
// This script runs under Node and drives a page, so it reaches both runtimes' globals. The
// project's lint is not type-aware and reads no environment from a file's extension, so the
// two sets are declared here rather than in the supplied configuration.
/* global console, process, window */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const out = path.join(root, "showcase");
const scratch = path.join(root, ".showcase-video");
const PORT = 4399;

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("build first: npm run build");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
fs.rmSync(scratch, { recursive: true, force: true });

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".mid": "audio/midi",
  ".css": "text/css",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(dist, p);
  if (
    !f.startsWith(dist) ||
    !fs.existsSync(f) ||
    fs.statSync(f).isDirectory()
  ) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": mime[path.extname(f)] ?? "application/octet-stream",
  });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: scratch, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__foundry, null, { timeout: 30000 });

const wait = (ms) => page.waitForTimeout(ms);

// The title, before anything is touched.
await wait(1600);
await page.screenshot({ path: path.join(out, "title.png") });

// Into a run through the menus' own choices.
await page.evaluate(() => {
  const f = window.__foundry;
  const b = f.menuButtons().find((x) => x.action === "salvage");
  f.pointerDown(b.x + b.w / 2, b.y + b.h / 2);
  f.pointerUp();
});
await wait(1200);
await page.screenshot({ path: path.join(out, "maps.png") });
await page.evaluate(() => {
  const f = window.__foundry;
  const b = f.menuButtons().find((x) => x.action === "map-substation");
  f.pointerDown(b.x + b.w / 2, b.y + b.h / 2);
  f.pointerUp();
});
await wait(1100);
await page.evaluate(() => {
  const f = window.__foundry;
  const b = f.menuButtons().find((x) => x.action === "difficulty-medium");
  f.pointerDown(b.x + b.w / 2, b.y + b.h / 2);
  f.pointerUp();
});
await wait(900);

// The anchors a player would walk the press along: just off the route, leg by leg.
const anchors = await page.evaluate(() => {
  const s = window.__foundry.snapshot();
  const chain = [s.entry, ...s.waypoints, s.collector];
  const list = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    for (let t = 0.14; t < 0.92; t += 0.16) {
      const col =
        Math.round(chain[i].col + (chain[i + 1].col - chain[i].col) * t) + 2;
      const row =
        Math.round(chain[i].row + (chain[i + 1].row - chain[i].row) * t) + 2;
      list.push([
        Math.max(0, Math.min(48, col)),
        Math.max(0, Math.min(31, row)),
      ]);
    }
  }
  return list;
});

let cursor = 0;
async function playLevel(shots) {
  // Pull the press and walk five rocks onto the yard, one visible drop at a time.
  await page.evaluate(() => {
    const f = window.__foundry;
    f.keyDown("KeyB");
    f.keyUp("KeyB");
  });
  for (let i = 0; i < 5; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const [col, row] = anchors[cursor++ % anchors.length];
      const landed = await page.evaluate(
        ([c, r]) => {
          const f = window.__foundry;
          const before = f.snapshot().structures.length;
          f.pointerMove(c * 20 + 20, 56 + r * 20 + 20);
          f.pointerDown(c * 20 + 20, 56 + r * 20 + 20);
          f.pointerUp();
          return f.snapshot().structures.length > before;
        },
        [col, row],
      );
      if (landed) break;
    }
    await wait(190);
  }
  // Refine the press whenever the bank allows, and take the best roll of the level.
  await page.evaluate(() => {
    const f = window.__foundry;
    for (let i = 0; i < 3; i++) f.upgradeQuality();
    const cands = f.snapshot().structures.filter((x) => x.kind === "candidate");
    cands.sort((a, b) => b.quality - a.quality || b.damage - a.damage);
    if (cands.length) {
      f.select(cands[0].id);
      f.keyDown("KeyK");
      f.keyUp("KeyK");
    }
  });
  for (const shot of shots ?? []) {
    await wait(shot.after);
    await page.screenshot({ path: path.join(out, shot.file) });
  }
  // Watch the wave crawl the maze under fire.
  const started = Date.now();
  while (Date.now() - started < 9000) {
    const phase = await page.evaluate(() => window.__foundry.snapshot().phase);
    if (phase === "build") break;
    await wait(250);
  }
}

await playLevel([{ after: 1600, file: "build.png" }]);
await playLevel();
await playLevel([{ after: 2600, file: "wave.png" }]);
await playLevel();

// The recipe book, the run's own reference for what a fold would build.
await page.evaluate(() => {
  const f = window.__foundry;
  f.keyDown("KeyV");
  f.keyUp("KeyV");
});
await wait(1500);
await page.screenshot({ path: path.join(out, "recipes.png") });
await page.evaluate(() => {
  const f = window.__foundry;
  f.keyDown("KeyV");
  f.keyUp("KeyV");
});
await wait(900);

await context.close();
await browser.close();
server.close();

// Playwright names the recording after the page; move it under the name the carousel uses.
const [recorded] = fs.readdirSync(scratch).filter((f) => f.endsWith(".webm"));
if (recorded)
  fs.copyFileSync(
    path.join(scratch, recorded),
    path.join(out, "gameplay.webm"),
  );
fs.rmSync(scratch, { recursive: true, force: true });
for (const f of fs.readdirSync(out)) {
  console.log(
    f,
    (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + " KiB",
  );
}
