// Shatter — bootstrap. Sets up the canvas (fitted and centered, letterboxed at
// any window size / pixel density), wires input, and runs a fixed-timestep
// loop: physics advances in fixed FIXED_STEP increments decoupled from
// rendering, so behavior is reproducible and independent of the frame rate.

import { FIELD_H, FIELD_W, FIXED_STEP } from "./constants";
import { installDebugApi } from "./debug";
import { Game } from "./game";
import { Input } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Shatter: 2D canvas context unavailable");

// Fit the fixed 1280x720 stage into the window, preserving 16:9, and back the
// canvas at the device pixel ratio so it is crisp on any display. The whole
// field stays visible and centered at any window size (specs/overview.md).
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(window.innerWidth / FIELD_W, window.innerHeight / FIELD_H);
  const cssW = Math.max(1, Math.round(FIELD_W * scale));
  const cssH = Math.max(1, Math.round(FIELD_H * scale));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

window.addEventListener("resize", resize);
resize();

const input = new Input();
input.attach();
const game = new Game(input);

// Install the debugging and automation API on window.__shatter (see debug.ts and
// specs/instrumentation.md). Inert during normal play.
installDebugApi(game);

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

  // Once-per-frame edge input (menu navigation, pause, mute).
  game.handleInput();

  // Fixed-timestep physics — but only while the manual clock hands the game the
  // clock (autoStep). When the debug API has taken it over, the loop still
  // renders every frame while step() alone advances the simulation, so a driven
  // scenario is exact regardless of frame timing (see specs/instrumentation.md).
  if (game.autoStep) {
    accumulator += dt;
    while (accumulator >= FIXED_STEP) {
      game.fixedStep(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  } else {
    accumulator = 0; // don't bank real time while manual
  }

  // What is left in the accumulator is time the display is showing but the
  // simulation has not stepped through yet. Hand it to the renderer as a
  // fraction of a step so it can draw between the last two states: the tick rate
  // and the refresh rate do not divide evenly, so the number of steps per frame
  // varies, and drawing the raw state would move every body by a different
  // distance each frame. Zero while the debug API holds the clock, so a posed
  // scenario is drawn exactly as it was stepped.
  game.renderAlpha = game.autoStep ? accumulator / FIXED_STEP : 0;

  // Render in logical space; the transform maps it to the backing store.
  const sx = canvas.width / FIELD_W;
  const sy = canvas.height / FIELD_H;
  ctx!.setTransform(sx, 0, 0, sy, 0, 0);
  render(ctx!, game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
