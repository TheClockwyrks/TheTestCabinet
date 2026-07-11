// Wireworm — bootstrap. Fits the fixed 1280x720 stage into the window (centered,
// letterboxed, correct at any size and pixel density, before any input), wires
// input and audio, and runs a fixed-timestep loop: the simulation advances in
// fixed FIXED_STEP increments decoupled from rendering.

import { FIXED_STEP, STAGE_H, STAGE_W } from "./constants";
import { Audio } from "./audio";
import { Game } from "./game";
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

// Expose the live game instance for smoke-testing / inspection. Inert during play.
(window as unknown as { __wireworm?: Game }).__wireworm = game;

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

  game.handleInput();

  accumulator += dt;
  let guard = 0;
  while (accumulator >= FIXED_STEP && guard++ < 8) {
    game.fixedStep(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }

  const sx = canvas.width / STAGE_W;
  const sy = canvas.height / STAGE_H;
  ctx!.setTransform(sx, 0, 0, sy, 0, 0);
  render(ctx!, game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
