// Wireworm — bootstrap. Fits the fixed 1280x720 stage into the window (centered,
// letterboxed, correct at any size and pixel density, before any input), wires
// input and audio, and runs a fixed-timestep loop: the simulation advances in
// fixed FIXED_STEP increments decoupled from rendering.

import { FIXED_STEP, STAGE_H, STAGE_W } from "./constants";
import { Audio } from "./audio";
import { Game } from "./game";
import { installDebugApi } from "./debug";
import { Input } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Wireworm: 2D canvas context unavailable");

// Fit the stage into the window preserving 16:9, backed at the device pixel ratio.
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

const input = new Input();
input.attach();
const audio = new Audio();
const game = new Game(input, audio);

// Install the debugging and automation API on window.__wireworm (see debug.ts and
// specs/instrumentation.md). Inert during normal play.
installDebugApi(game);

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

  game.handleInput();

  // The manual clock (specs/instrumentation.md): advance the simulation from the
  // wall clock only while autoStep is true (ordinary play). In manual mode the loop
  // still renders every frame but leaves stepping to the debug API's step(), so no
  // stray wall-clock frame pollutes a measurement.
  if (game.autoStep) {
    accumulator += dt;
    let guard = 0;
    while (accumulator >= FIXED_STEP && guard++ < 8) {
      game.fixedStep(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  } else {
    accumulator = 0;
  }

  // What is left in the accumulator is time the display is showing but the
  // simulation has not stepped through yet. Hand it to the renderer as a
  // fraction of a step so it can draw between the last two states: the tick rate
  // and the refresh rate do not divide evenly, so the number of steps per frame
  // varies, and drawing the raw state would move everything by a different
  // distance each frame. Zero while the debug API holds the clock, so a posed
  // scenario is drawn exactly as it was stepped.
  game.renderAlpha = game.autoStep ? accumulator / FIXED_STEP : 0;

  const sx = canvas.width / STAGE_W;
  const sy = canvas.height / STAGE_H;
  ctx!.setTransform(sx, 0, 0, sy, 0, 0);
  render(ctx!, game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
