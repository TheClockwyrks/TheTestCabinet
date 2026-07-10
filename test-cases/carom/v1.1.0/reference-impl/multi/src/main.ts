// Carom — bootstrap. Sets up the canvas (fitted and centered, letterboxed at any
// window size / pixel density), wires input, and runs a fixed-timestep loop:
// physics advances in fixed FIXED_STEP increments decoupled from rendering.

import { FIELD_H, FIELD_W, FIXED_STEP } from "./constants";
import { Game } from "./game";
import { Input } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Carom: 2D canvas context unavailable");

// Fit the fixed 1280x720 stage into the window, preserving 16:9, and back the
// canvas at the device pixel ratio so it is crisp on any display.
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(
    window.innerWidth / FIELD_W,
    window.innerHeight / FIELD_H,
  );
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

// Expose the live game instance for the Playwright proof-capture script (see
// scripts/capture-proof.mjs). It is inert during normal play and does not affect
// gameplay.
(window as unknown as { __carom?: Game }).__carom = game;

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

  // Once-per-frame edge input (menu navigation, pause, mute).
  game.handleInput();

  // Fixed-timestep physics.
  accumulator += dt;
  while (accumulator >= FIXED_STEP) {
    game.fixedStep(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }

  // Render in logical space; the transform maps it to the backing store.
  const sx = canvas.width / FIELD_W;
  const sy = canvas.height / FIELD_H;
  ctx!.setTransform(sx, 0, 0, sy, 0, 0);
  render(ctx!, game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
