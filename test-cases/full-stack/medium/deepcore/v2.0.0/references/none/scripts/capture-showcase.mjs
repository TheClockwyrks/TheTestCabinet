/* global console, process, window */
// Deepcore — capture the showcase (specs/showcase.md).
//
// Serves the production build over a sub-path, drives it in Chromium, and writes the
// carousel's media into showcase/. The clip is real play: the expedition is arranged
// through the game's own controls and then driven with held keys on the wall clock, so
// what the video shows is the game's own physics, drill, and economy producing the
// outcome rather than a posed one.
//
//   npm run build && node scripts/capture-showcase.mjs
//
// The recorder writes VP8 at its own bitrate. Where an ffmpeg is on the PATH (or named
// by SHOWCASE_FFMPEG) the clip is re-encoded smaller; without one the recording is kept
// as it came, which is the same footage at a larger file size.

import { spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "showcase");
const SCRATCH = path.join(ROOT, ".showcase-capture");

// A sub-path, so the capture also proves the built site runs off a host root.
const BASE = "/runs/showcase/build";
const PORT = 4407;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".json": "application/json",
};

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (!p.startsWith(BASE)) {
      res.writeHead(404);
      res.end();
      return;
    }
    p = p.slice(BASE.length) || "/";
    if (p === "/") p = "/index.html";
    const file = path.join(DIST, p);
    if (
      !file.startsWith(DIST) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const wait = (page, ms) => page.waitForTimeout(ms);

/** Write the recording out, re-encoded smaller where an ffmpeg can do it. */
function writeClip(raw, out) {
  const ffmpeg = process.env.SHOWCASE_FFMPEG ?? "ffmpeg";
  const run = spawnSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-y",
      "-i",
      raw,
      "-c:v",
      "libvpx",
      "-b:v",
      "420k",
      "-crf",
      "36",
      "-an",
      out,
    ],
    { stdio: "ignore" },
  );
  if (run.status === 0 && fs.existsSync(out)) return;
  console.log("no ffmpeg found; keeping the recording as it came");
  fs.copyFileSync(raw, out);
}

/** Arrange one expedition, through the game's own menus and shop controls. */
async function arrange(page) {
  await page.evaluate(() => {
    const d = window.__deepcore;
    d.reset();
  });
  // Through the menus, exactly as a player does: NEW EXPEDITION, STANDARD, STANDARD.
  await page.evaluate(() => {
    const d = window.__deepcore;
    for (const code of ["Enter", "Enter", "ArrowDown", "Enter"]) {
      d.keyDown(code);
      d.keyUp(code);
    }
  });
  // A few tiers bought at the shop, so the dig reads at the pace a played run reaches.
  await page.evaluate(() => {
    const d = window.__deepcore;
    d.setCredits(20000);
    d.buyUpgrade("drill");
    d.buyUpgrade("drill");
    d.buyUpgrade("cargo");
    d.buyUpgrade("jetpack");
    d.buyUpgrade("scanner");
    d.setCredits(1200);
  });
}

/** Hold a key for `ms` of wall-clock time, letting the game's own loop run. */
async function holdFor(page, code, ms) {
  await page.evaluate((c) => window.__deepcore.keyDown(c), code);
  await wait(page, ms);
  await page.evaluate((c) => window.__deepcore.keyUp(c), code);
}

async function main() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const server = await serve();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // ---- The clip: one dig, from the camp down and back ----
  const clipContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: SCRATCH, size: { width: 1280, height: 720 } },
  });
  const clip = await clipContext.newPage();
  await clip.goto(`http://localhost:${PORT}${BASE}/`, { waitUntil: "load" });
  await clip.waitForFunction(() => !!window.__deepcore, null, {
    timeout: 30000,
  });
  await arrange(clip);

  await wait(clip, 900); // the camp, before the first step
  await holdFor(clip, "KeyD", 4200); // walk east across the camp
  await wait(clip, 400);
  await holdFor(clip, "KeyS", 13000); // bore down through the topsoil and into the rockbed
  await wait(clip, 600);
  await holdFor(clip, "KeyW", 6500); // fly the haul back up
  await wait(clip, 1200);

  const video = clip.video();
  await clipContext.close();
  const raw = await video.path();
  writeClip(raw, path.join(OUT, "dig.webm"));

  // ---- The stills ----
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}${BASE}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__deepcore, null, {
    timeout: 30000,
  });

  await arrange(page);
  await wait(page, 500);
  await page.screenshot({ path: path.join(OUT, "camp.png") });

  // The Launch Pad, at the camp where a player opens it, with the rocket part-built.
  await page.evaluate(() => {
    const d = window.__deepcore;
    d.setCredits(9000);
    d.setRocketInstalled(2);
    d.setPanel("launch-pad");
  });
  await wait(page, 400);
  await page.screenshot({ path: path.join(OUT, "launch-pad.png") });
  await page.evaluate(() => {
    const d = window.__deepcore;
    d.setPanel(null);
    d.setRocketInstalled(0);
    d.setCredits(1200);
  });

  // Deep in the rockbed, mid-cut, with a haul aboard: the shot the dig earns.
  await page.evaluate(() => {
    const d = window.__deepcore;
    d.keyDown("KeyD");
  });
  await wait(page, 4200);
  await page.evaluate(() => {
    const d = window.__deepcore;
    d.keyUp("KeyD");
    d.keyDown("KeyS");
  });
  await wait(page, 16000);
  await page.screenshot({ path: path.join(OUT, "shaft.png") });
  await page.evaluate(() => window.__deepcore.keyUp("KeyS"));

  await context.close();
  await browser.close();
  server.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  console.log("showcase media written to", OUT);
}

await main();
