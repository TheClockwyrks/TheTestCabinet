// Coil — build verification (reference/README.md, specs/proof.md).
//
// Serves the BUILT dist/ under a NON-ROOT sub-path (proving the base-path safety the
// production contract requires), loads it at 1280×720 with the project-local Playwright +
// Chromium, and asserts — through the window.__coil dev surface, driving the sim exactly the
// way a key press does — that:
//   • the page loads with ZERO console / pageerror / requestfailed errors,
//   • state() === "title" on load,
//   • start() begins a round,
//   • stepping ticks advances the snake exactly one cell per tick,
//   • requestTurn turns on the next tick, and a reversal into the neck is ignored,
//   • eating a pellet grows the snake by exactly one and raises the score and the combo,
//   • running into a wall reaches "gameover".
// Exits 0 only if every check passes and no errors were seen.

import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");
const BASE = "/runs/demo/build";

if (!existsSync(path.join(dist, "index.html"))) {
  console.error("verify: dist/index.html missing — run `npm run build` first.");
  process.exit(1);
}

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

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && errors.push(`CONSOLE: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("requestfailed", (r) => errors.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));

// Seed a plausible BEST and a muted flag, exactly as the capture flow does.
await page.addInitScript(() => {
  localStorage.setItem("coil.best", "1180");
  localStorage.setItem("coil.muted", "1");
});

await page.goto(url, { waitUntil: "networkidle" });
// Give the produced sprites a moment to finish loading (they gate __coil rendering).
await page.waitForFunction(() => !!window.__coil, null, { timeout: 5000 });
await new Promise((r) => setTimeout(r, 300));

const checks = await page.evaluate(async () => {
  const C = window.__coil;
  const r = {};

  r.titleOnLoad = C.state() === "title";

  // ---- start a round -------------------------------------------------------
  C.start();
  r.startedPlaying = C.state() === "playing";
  let sim = C.sim;

  // ---- one cell per tick (starts moving right) -----------------------------
  const h0 = { ...sim.snake[0] };
  C.step(1);
  const h1 = { ...sim.snake[0] };
  r.movedOneCell = h1.col === h0.col + 1 && h1.row === h0.row;

  // ---- a turn takes effect on the NEXT tick --------------------------------
  sim.requestTurn("down");
  C.step(1);
  const h2 = { ...sim.snake[0] };
  r.turnedNextTick = h2.row === h1.row + 1 && h2.col === h1.col;

  // ---- a reversal into the neck is ignored ---------------------------------
  // Now moving down; requesting up is a reversal and must be discarded (keep going down).
  sim.requestTurn("up");
  C.step(1);
  const h3 = { ...sim.snake[0] };
  r.reversalIgnored = h3.row === h2.row + 1 && h3.col === h2.col;

  // ---- eating grows by one and raises score + combo ------------------------
  C.start();
  sim = C.sim;
  const opp = { up: "down", down: "up", left: "right", right: "left" };
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function chooseDir(s) {
    const head = s.snake[0];
    const p = s.pellet;
    const cur = s.snake;
    const obst = new Set((s.obstacles || []).map((o) => o.col + "," + o.row));
    function fatalNext(nc, nr, willEat) {
      if (nc < 1 || nc > 28 || nr < 1 || nr > 16) return true;
      if (obst.has(nc + "," + nr)) return true;
      for (let i = 0; i < cur.length; i++) {
        const c = cur[i];
        if (c.col === nc && c.row === nr) {
          if (!willEat && i === cur.length - 1) continue; // tail vacates on a normal move
          return true;
        }
      }
      return false;
    }
    let best = null;
    let bestDist = Infinity;
    for (const d of ["up", "down", "left", "right"]) {
      if (d === opp[s.dir]) continue; // never reverse
      const [dc, dr] = delta[d];
      const nc = head.col + dc;
      const nr = head.row + dr;
      const willEat = nc === p.col && nr === p.row;
      if (fatalNext(nc, nr, willEat)) continue;
      const dist = Math.abs(nc - p.col) + Math.abs(nr - p.row);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  let eats = 0;
  let maxCombo = 1;
  let growthOk = true;
  for (let iter = 0; iter < 4000 && eats < 5; iter++) {
    const before = sim.snake.length;
    const scoreBefore = sim.score;
    const d = chooseDir(sim);
    if (d) sim.requestTurn(d);
    C.step(1);
    if (sim.ended) break;
    if (sim.score > scoreBefore) {
      eats++;
      maxCombo = Math.max(maxCombo, sim.combo);
      if (sim.snake.length !== before + 1) growthOk = false;
    }
  }
  r.ateAtLeastOne = eats >= 1;
  r.grewByExactlyOne = growthOk;
  r.scoreRose = sim.score > 0;
  r.comboRose = maxCombo >= 2;
  r.pelletValid = sim.pellet.col >= 1 && sim.pellet.col <= 28 && sim.pellet.row >= 1 && sim.pellet.row <= 16;

  // ---- running into a wall reaches gameover --------------------------------
  C.start();
  sim = C.sim; // fresh round, moving right; stop steering and run straight into the wall
  let ended = false;
  for (let i = 0; i < 80; i++) {
    C.step(1);
    if (sim.ended) {
      ended = true;
      break;
    }
  }
  r.wallGameover = ended && C.state() === "gameover";

  return r;
});

await browser.close();
server.close();

const order = [
  "titleOnLoad",
  "startedPlaying",
  "movedOneCell",
  "turnedNextTick",
  "reversalIgnored",
  "ateAtLeastOne",
  "grewByExactlyOne",
  "scoreRose",
  "comboRose",
  "pelletValid",
  "wallGameover",
];

console.log("--- checks ---");
let allPass = true;
for (const k of order) {
  const ok = checks[k] === true;
  if (!ok) allPass = false;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
console.log("--- errors ---");
console.log(`  ${errors.length} console/page/request errors`);
for (const e of errors.slice(0, 25)) console.log("   -", e);

const ok = allPass && errors.length === 0;
console.log(ok ? "VERIFY OK" : "VERIFY FAILED");
process.exit(ok ? 0 : 1);
