// Kessler — capture the showcase media (specs/showcase.md).
//
// Serves the built site, plays it in a real browser with real key presses, and
// writes the clip and the stills the carousel names into `showcase/`. Nothing
// here poses an outcome: the bot reads the field through the game's own
// snapshot and presses the very keys a player presses — it holds a rotate key
// to swing the deflector under the falling ball, taps `Space` to serve, and
// chases salvage pods when there is time to reach them — so what the clip
// shows is the game playing itself rather than a scene arranged from outside.
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
 * Each frame it reads the snapshot, predicts where the most urgent falling
 * thing — the soonest inward-heading ball, or a salvage pod it has time for —
 * will cross the deflector's radius, and holds one rotate key toward that
 * angle. Everything it does, a player could do with their hands.
 */
const BOT = String(function bot(durationMs, stopWhen) {
  const api = window.__kessler;
  const CENTER = 500;
  const CATCH_R = 194;
  const POD_CATCH_R = 196;
  const POD_SPEED = 120;
  const press = (code) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code }));
  };
  let held = null;
  const hold = (code) => {
    if (held === code) return;
    if (held) window.dispatchEvent(new KeyboardEvent("keyup", { code: held }));
    held = code;
    if (code) window.dispatchEvent(new KeyboardEvent("keydown", { code }));
  };

  const angleOf = (x, y) =>
    (Math.atan2(y - CENTER, x - CENTER) * 180) / Math.PI;
  const wrap = (deg) => {
    let a = deg % 360;
    if (a < -180) a += 360;
    if (a >= 180) a -= 360;
    return a;
  };

  /**
   * When and where a ball's straight flight crosses the deflector radius:
   * solve |p + t v| = CATCH_R for the earliest t at or after now. Returns
   * `null` while the ball is outward bound or the crossing is out of reach.
   */
  const crossing = (ball) => {
    const px = ball.x - CENTER;
    const py = ball.y - CENTER;
    const a = ball.vx * ball.vx + ball.vy * ball.vy;
    if (a === 0) return null;
    const b = 2 * (px * ball.vx + py * ball.vy);
    const c = px * px + py * py - CATCH_R * CATCH_R;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) return null;
    return {
      t,
      angle: angleOf(ball.x + ball.vx * t, ball.y + ball.vy * t),
    };
  };

  /** The angle to swing to, and how soon it matters. */
  const plan = (state) => {
    let best = null;
    for (const ball of state.balls) {
      if (ball.parked) continue;
      const hit = crossing(ball);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    // A pod is worth a detour when it lands before the next ball does.
    for (const pod of state.pods) {
      const r = Math.hypot(pod.x - CENTER, pod.y - CENTER);
      const t = (r - POD_CATCH_R) / POD_SPEED;
      if (t < 0) continue;
      if (!best || t < best.t - 0.3) best = { t, angle: angleOf(pod.x, pod.y) };
    }
    if (best) return best;
    // Nothing is falling: shadow the flying ball so the swing back is short.
    const flying = state.balls.find((ball) => !ball.parked);
    if (flying) return { t: Infinity, angle: angleOf(flying.x, flying.y) };
    return null;
  };

  return new Promise((resolve) => {
    const started = performance.now();
    let bestScore = 0;
    let bestWave = 1;
    let deaths = 0;
    let lastScreen = "title";
    const frame = () => {
      const state = api.snapshot();
      bestScore = Math.max(bestScore, state.score);
      bestWave = Math.max(bestWave, state.wave);
      if (state.screen === "playing") {
        if (state.balls.some((ball) => ball.parked)) press("Space");
        const goal = plan(state);
        if (goal) {
          const diff = wrap(goal.angle - state.paddle.angleDeg);
          if (Math.abs(diff) < 4) hold(null);
          else hold(diff > 0 ? "ArrowRight" : "ArrowLeft");
        } else {
          hold(null);
        }
      } else if (state.screen !== "waveclear") {
        if (state.screen === "gameover" && lastScreen === "playing")
          deaths += 1;
        hold(null);
        press("Enter");
      }
      lastScreen = state.screen;
      const elapsed = performance.now() - started;
      const posed = stopWhen ? stopWhen(state, elapsed) : false;
      if (elapsed >= durationMs || posed) {
        hold(null);
        resolve({ bestScore, bestWave, deaths, score: state.score });
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
});

/** Run the bot inside `page` until `stop` (source text) says the shot is set. */
async function play(page, ms, stop) {
  return page.evaluate(
    ([source, duration, when]) =>
      new Function(`return (${source})`)()(
        duration,
        when ? new Function(`return (${when})`)() : null,
      ),
    [BOT, ms, stop ?? null],
  );
}

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
    viewport: { width: 960, height: 960 },
    recordVideo: { dir: scratch, size: { width: 960, height: 960 } },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kessler !== undefined);
  const played = await play(page, SECONDS * 1000);
  const video = page.video();
  await context.close();
  const recorded = await video.path();
  await fs.copyFile(recorded, path.join(OUT, "rally.webm"));
  console.log(
    `clip captured: score ${played.bestScore}, wave ${played.bestWave}, ${played.deaths} death(s)`,
  );

  // The stills, taken from the same game played the same way.
  const stills = await browser.newContext({
    viewport: { width: 960, height: 960 },
  });
  const still = await stills.newPage();
  await still.goto(`http://127.0.0.1:${port}/`);
  await still.waitForFunction(() => window.__kessler !== undefined);
  await still.screenshot({ path: path.join(OUT, "title.png") });
  // A still wants a moment worth showing: a live rally with visible progress —
  // a real score on the board and a ball in flight.
  const posed = await play(
    still,
    60_000,
    String(function stop(state, elapsed) {
      return (
        elapsed > 5_000 &&
        state.screen === "playing" &&
        state.score >= 600 &&
        state.balls.some((ball) => !ball.parked)
      );
    }),
  );
  await still.screenshot({ path: path.join(OUT, "mid-wave.png") });
  console.log(`still captured at a score of ${posed.score}`);
  await stills.close();

  await browser.close();
  server.close();
  await fs.rm(scratch, { recursive: true, force: true });
  console.log(`showcase media written to ${OUT}`);
}

await main();
