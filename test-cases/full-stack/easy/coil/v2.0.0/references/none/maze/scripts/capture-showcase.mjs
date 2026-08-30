// Coil — capture the showcase media (specs/showcase.md).
//
// Serves the built site, plays it in a real browser with real key presses, and
// writes the clip and the stills the carousel names into `showcase/`. Nothing here
// poses an outcome: the bot reads the board through the game's own snapshot and
// presses the very keys a player presses, so what the clip shows is the game
// playing itself rather than a scene arranged from outside.
//
// Usage:  node scripts/capture-showcase.mjs [seconds]
// The build must already be in `dist/`, and Playwright's Chromium installed.

import console from "node:console";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { chromium } from "playwright";

// The bot below is written to run inside the page, so it names browser globals
// this file never itself calls. Declared here because the project's lint config
// gives a plain script no environment of its own.
/* global window, KeyboardEvent, performance, requestAnimationFrame */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "showcase");
const SECONDS = Number(process.argv[2] ?? 30);

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wav": "audio/wav",
  ".png": "image/png",
};

/** Serve `dist/` on an ephemeral port, and report the address. */
async function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const name = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.join(DIST, decodeURIComponent(name));
    fs.readFile(file).then(
      (body) => {
        res.writeHead(200, {
          "content-type":
            TYPES[path.extname(file)] ?? "application/octet-stream",
        });
        res.end(body);
      },
      () => {
        res.writeHead(404);
        res.end("not found");
      },
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

/**
 * The bot, as it runs inside the page.
 *
 * It reads the snapshot, plans a route to the pellet that keeps enough room to
 * get out again, and presses one direction key a tick. Everything it does, a
 * player could do with their hands.
 */
const BOT = String(function bot(durationMs, comboWanted) {
  const api = window.__coil;
  const KEY = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };
  const DELTA = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };
  const COLS = 30;
  const ROWS = 18;
  const press = (code) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { code }));
  const key = (col, row) => row * COLS + col;
  const interior = (col, row) =>
    col > 0 && col < COLS - 1 && row > 0 && row < ROWS - 1;

  const blocked = (state, keepTail) => {
    const set = new Set();
    for (const cell of state.obstacles) set.add(key(cell.col, cell.row));
    const body = keepTail ? state.snake : state.snake.slice(0, -1);
    for (const cell of body) set.add(key(cell.col, cell.row));
    return set;
  };

  /** Breadth-first search from `from` to `to`, returning the first step taken. */
  const routeTo = (from, to, walls) => {
    const previous = new Map();
    const start = key(from.col, from.row);
    const queue = [from];
    previous.set(start, null);
    while (queue.length > 0) {
      const at = queue.shift();
      if (at.col === to.col && at.row === to.row) {
        let node = key(at.col, at.row);
        let step = at;
        while (previous.get(node) !== null) {
          step = previous.get(node);
          node = key(step.col, step.row);
        }
        return step;
      }
      for (const [col, row] of Object.values(DELTA)) {
        const next = { col: at.col + col, row: at.row + row };
        const id = key(next.col, next.row);
        if (!interior(next.col, next.row)) continue;
        if (walls.has(id) || previous.has(id)) continue;
        previous.set(id, at);
        queue.push(next);
      }
    }
    return null;
  };

  /** How many cells the head can still reach from `cell`. */
  const room = (cell, walls) => {
    const seen = new Set([key(cell.col, cell.row)]);
    const queue = [cell];
    while (queue.length > 0) {
      const at = queue.shift();
      for (const [col, row] of Object.values(DELTA)) {
        const next = { col: at.col + col, row: at.row + row };
        const id = key(next.col, next.row);
        if (!interior(next.col, next.row)) continue;
        if (walls.has(id) || seen.has(id)) continue;
        seen.add(id);
        queue.push(next);
      }
    }
    return seen.size;
  };

  const plan = (state) => {
    const head = state.snake[0];
    const walls = blocked(state, false);
    const candidates = [];
    for (const [name, [col, row]] of Object.entries(DELTA)) {
      const next = { col: head.col + col, row: head.row + row };
      if (!interior(next.col, next.row)) continue;
      if (walls.has(key(next.col, next.row))) continue;
      const after = blocked(state, true);
      after.delete(key(next.col, next.row));
      candidates.push({ name, next, room: room(next, after) });
    }
    if (candidates.length === 0) return null;
    // Head for the pellet when the route leaves room to get out again.
    if (state.pellet) {
      const step = routeTo(head, state.pellet, walls);
      if (step) {
        const chosen = candidates.find(
          (entry) => entry.next.col === step.col && entry.next.row === step.row,
        );
        if (chosen && chosen.room > state.snake.length + 2) return chosen.name;
      }
    }
    // Otherwise take the opening with the most room left in it.
    candidates.sort((a, b) => b.room - a.room);
    return candidates[0].name;
  };

  return new Promise((resolve) => {
    const started = performance.now();
    let lastTick = -1;
    let bestCombo = 1;
    let comboSeen = false;
    const frame = () => {
      const state = api.snapshot();
      if (state.screen !== "playing") {
        press("Enter");
      } else if (state.ticks !== lastTick) {
        lastTick = state.ticks;
        bestCombo = Math.max(bestCombo, state.combo);
        if (state.combo >= comboWanted) comboSeen = true;
        const dir = plan(state);
        if (dir && dir !== state.dir) press(KEY[dir]);
      }
      if (performance.now() - started >= durationMs) {
        resolve({ bestCombo, comboSeen });
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
});

async function main() {
  const { server, port } = await serve();
  const scratch = path.join(ROOT, ".showcase-capture");
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.mkdir(scratch, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  // The clip: one sustained run of real play, recorded off the screen.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: scratch, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__coil !== undefined);
  const played = await page.evaluate(
    ([source, ms, combo]) => new Function(`return (${source})`)()(ms, combo),
    [BOT, SECONDS * 1000, 5],
  );
  const video = page.video();
  await context.close();
  const recorded = await video.path();
  await fs.copyFile(recorded, path.join(OUT, "combo-run.webm"));
  console.log(`clip captured, best combo x${played.bestCombo}`);

  // The stills, taken from the same game played the same way.
  const stills = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const still = await stills.newPage();
  await still.goto(`http://127.0.0.1:${port}/`);
  await still.waitForFunction(() => window.__coil !== undefined);
  await still.screenshot({ path: path.join(OUT, "title.png") });
  await still.evaluate(
    ([source, ms, combo]) => new Function(`return (${source})`)()(ms, combo),
    [BOT, 22_000, 4],
  );
  await still.screenshot({ path: path.join(OUT, "mid-run.png") });
  await stills.close();

  await browser.close();
  server.close();
  await fs.rm(scratch, { recursive: true, force: true });
  console.log(`showcase media written to ${OUT}`);
}

await main();
