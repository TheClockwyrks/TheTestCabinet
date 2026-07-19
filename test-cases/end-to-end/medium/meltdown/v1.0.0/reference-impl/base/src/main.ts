// Meltdown — bootstrap. Fits the fixed 1280x720 stage into the window
// (letterboxed, centred, crisp at any pixel density), wires input, and runs a
// fixed-timestep loop: the simulation advances in fixed FIXED_STEP increments
// decoupled from rendering, and the 2x game-speed control runs two sim steps per
// step without changing the outcome (specs/controls.md).

import { FIXED_STEP, STAGE_H, STAGE_W } from "./constants";
import { installDebugApi } from "./debug";
import { Game } from "./game";
import { Input } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Meltdown: 2D canvas context unavailable");

// Fit the fixed 1280x720 stage into the window, preserving 16:9, backing the
// canvas at the device pixel ratio so the whole stage stays visible and crisp.
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

const input = new Input(canvas);
input.attach();
const game = new Game(input);

// Install the debugging and automation API on window.__meltdown (see debug.ts
// and specs/instrumentation.md). Inert during normal play.
installDebugApi(game);

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

  game.handleInput();

  // Manual-clock model (specs/instrumentation.md): the animation loop advances
  // the simulation only while autoStep is true (normal play). When the debug API
  // holds the clock (autoStep false) the loop still renders every frame but does
  // not advance the sim — the driver's step() is the sole clock.
  if (game.autoStep) {
    accumulator += dt;
    while (accumulator >= FIXED_STEP) {
      const steps = game.state === "playing" ? game.speed : 1;
      for (let k = 0; k < steps; k++) game.fixedStep(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  } else {
    accumulator = 0;
  }

  game.updatePointer();

  const sx = canvas.width / STAGE_W;
  const sy = canvas.height / STAGE_H;
  ctx!.setTransform(sx, 0, 0, sy, 0, 0);
  render(ctx!, game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
