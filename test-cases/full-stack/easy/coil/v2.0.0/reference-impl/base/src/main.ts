// Coil — bootstrap, the fixed-timestep loop, and input routing (specs/movement.md,
// specs/ui.md).
//
// Loads the produced assets, fits the fixed 1280×720 stage into the window (letterboxed,
// centred, crisp at any device-pixel ratio and correct on load before any input), builds the
// audio / game / input systems, and runs the loop: rendering on every animation frame
// (decoupled from the sim) while the simulation advances in fixed 125 ms ticks only while
// playing AND the manual clock is off (autoStep, specs/instrumentation.md). The head-bite
// animation and the audio cues are driven from the per-tick events the game returns.
// `installDebugApi` exposes window.__coil for driving and inspecting the game from code; it
// is inert during normal play.

import { STAGE_H, STAGE_W, TICK_DT } from "./constants";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { installDebugApi } from "./debug";
import { Game } from "./game";
import type { TickEvents } from "./game";
import { Input } from "./input";
import { MODE } from "./mode";
import { render, setAssets } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Coil: 2D canvas context unavailable");

// Fit the fixed stage into the window: letterboxed, centred by the flex body, crisp at any
// device-pixel ratio. Called on load (before any input) and on every resize.
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const cssW = Math.max(1, Math.round(STAGE_W * scale));
  const cssH = Math.max(1, Math.round(STAGE_H * scale));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener("resize", resize);
resize();

const BITE_FRAME_S = 0.055; // seconds per bite frame (frames 1,2,3 then back to rest)

async function main(): Promise<void> {
  const assets = await loadAssets();
  setAssets(assets);
  const audio = new Audio(assets.audioUrl);
  const input = new Input();
  input.attach();
  const game = new Game(MODE, audio, input);

  // Install the debugging and automation API on window.__coil (see debug.ts and
  // specs/instrumentation.md). Inert during normal play.
  installDebugApi(game);

  let elapsed = 0;
  let lastEat = -10; // start well before now so no bite plays on load

  // The bite anim only — the audio cues themselves are played by Game.advance() (see
  // game.ts), so they fire identically whether a tick is driven by this wall-clock loop
  // or by the debug API's step().
  function applyEvents(ev: TickEvents): void {
    if (ev.ate) lastEat = elapsed;
  }

  function biteFrame(): number {
    if (game.state !== "playing") return 0;
    const t = elapsed - lastEat;
    if (t < 0) return 0;
    const idx = Math.floor(t / BITE_FRAME_S);
    return idx < 3 ? idx + 1 : 0; // frames 1,2,3 then rest
  }

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    elapsed += dt;

    game.handleInput();

    // Fixed-step simulation: advance the sim in whole 125 ms ticks while playing, but only
    // when the manual clock is off (autoStep). A driver that took the clock via step() or
    // setAutoStep(false) is not double-advanced by this loop.
    if (game.state === "playing" && game.autoStep) {
      acc += dt;
      let steps = 0;
      while (acc >= TICK_DT && steps < 10) {
        const ev = game.autoTick();
        if (ev) applyEvents(ev);
        acc -= TICK_DT;
        steps++;
        if (game.state !== "playing") break;
      }
    } else {
      acc = 0;
    }

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    render(ctx!, game, { time: elapsed, biteFrame: biteFrame(), muted: audio.muted });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
