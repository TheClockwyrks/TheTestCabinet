// Carom — proof-of-implementation capture.
//
// Serves the production build (dist/) and drives it with the project-local
// Playwright Chromium to capture the screenshots and rally clip required by
// specs/proof.md, written to exactly:
//   proof/title.png, proof/gameplay.png, proof/game-over.png, proof/rally.webm
//
// Usage:  npm run build && npx playwright install chromium && npm run capture-proof

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const proofDir = path.join(root, "proof");

if (!existsSync(path.join(dist, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(dist, url === "/" ? "index.html" : url);
    if (!file.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file)) file = path.join(dist, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

await mkdir(proofDir, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });

const errors = [];

async function newPage(context) {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}

// ---- Screenshots (title, gameplay, game-over) ----
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await newPage(context);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__carom);
  await sleep(400);

  // Title: on load, all menu items visible.
  await page.screenshot({ path: path.join(proofDir, "title.png") });

  // Gameplay: start Solo, then pose a representative live rally frame with a
  // built-up motion trail, both obstacles, both paddles and HUD scores.
  await page.keyboard.press("Enter");
  await sleep(200);
  await page.evaluate(() => {
    const g = window.__carom;
    g.scoreP1 = 7;
    g.scoreP2 = 5;
    g.state = "playing";
    g.left.cy = 300;
    g.right.cy = 420;
    // Ball traveling up-and-right across open field with spin, so the comet
    // trail streams behind it curving down-left (as in reference/gameplay).
    g.ball.x = 610;
    g.ball.y = 445;
    const sp = 780;
    const ang = (26 * Math.PI) / 180;
    g.ball.vx = Math.cos(ang) * sp;
    g.ball.vy = -Math.sin(ang) * sp;
    g.ball.spin = -430; // visible curve in the trail
    g.trail.reset();
  });
  await sleep(230); // let the comet trail build over recent travel
  await page.screenshot({ path: path.join(proofDir, "gameplay.png") });

  // Game over: drive to a finished match and show the result screen.
  await page.evaluate(() => {
    const g = window.__carom;
    g.scoreP1 = 11;
    g.scoreP2 = 7;
    g.winner = "left";
    g.state = "matchover";
    g.menuIndex = 0;
  });
  await sleep(200);
  await page.screenshot({ path: path.join(proofDir, "game-over.png") });

  await context.close();
}

// ---- Rally clip (webm) ----
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: proofDir, size: { width: 1280, height: 720 } },
  });
  const page = await newPage(context);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__carom);

  // Start Solo and install a helper that returns the left paddle so a genuine,
  // sustained rally plays out — the ball accelerates across several hits and its
  // trail tracks it — for the length of the clip.
  await page.keyboard.press("Enter");
  await sleep(200);
  await page.evaluate(() => {
    const g = window.__carom;
    g.scoreP1 = 3;
    g.scoreP2 = 2;
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const tick = () => {
      // Track the ball so the left paddle keeps the rally alive.
      const target = clamp(g.ball.y, 55, 665);
      g.left.cy += clamp(target - g.left.cy, -12, 12);
      window.__caromRally = requestAnimationFrame(tick);
    };
    tick();
  });
  await sleep(5200);
  await page.evaluate(() => cancelAnimationFrame(window.__caromRally));

  const video = page.video();
  await context.close();
  if (video) {
    const tmp = await video.path();
    const dest = path.join(proofDir, "rally.webm");
    await rm(dest, { force: true });
    await rename(tmp, dest);
  }
}

await browser.close();
server.close();

if (errors.length) {
  console.error("Console/page errors during capture:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Proof captured to", proofDir);
