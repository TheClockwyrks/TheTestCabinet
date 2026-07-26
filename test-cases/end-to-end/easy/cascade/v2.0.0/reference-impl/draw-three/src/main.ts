// Cascade — bootstrap. Sets up the canvas (fitted and centered, letterboxed at any
// window size / pixel density), wires input, and runs the render loop. The victory
// cascade advances on its own fixed timestep inside the loop, decoupled from the
// render frame rate (see game.updateCascade / cascade.ts).

import { FIELD_H, FIELD_W } from "./constants";
import { installDebugApi } from "./debug";
import { Game } from "./game";
import { attachInput } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Cascade: 2D canvas context unavailable");

// Fit the fixed 1280x720 stage into the window, preserving 16:9, and back the
// canvas at the device pixel ratio so it is crisp on any display. The whole table
// is always visible, fitted and centered (the body flex-centers the canvas).
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

const game = new Game();
attachInput(canvas, game);

// Install the debugging and automation API on window.__cascade (see debug.ts and
// specs/instrumentation.md). Inert during normal play.
installDebugApi(game);

let last = performance.now();

function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

  // Advance the victory cascade from the wall clock (a no-op unless the game is
  // won). While the manual clock is engaged (autoStep false) the driver advances
  // it through step() instead, and the loop only renders (specs/instrumentation.md).
  if (game.autoStep) game.updateCascade(dt);

  // Map the logical 1280x720 space onto the backing store.
  const sx = canvas.width / FIELD_W;
  const sy = canvas.height / FIELD_H;
  ctx!.setTransform(sx, 0, 0, sy, 0, 0);
  render(ctx!, game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
