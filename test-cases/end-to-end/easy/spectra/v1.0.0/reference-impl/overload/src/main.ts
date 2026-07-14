// Spectra — bootstrap. Loads the provided art, fits the fixed 1280x720 stage into
// the window (letterboxed, centered, crisp at any pixel density), wires input, and
// runs a fixed-timestep loop: simulation advances in fixed FIXED_STEP increments
// decoupled from rendering (specs/controls.md).

import { loadAssets } from "./assets";
import { FIELD_H, FIELD_W, FIXED_STEP } from "./constants";
import { Game } from "./game";
import { Input } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Spectra: 2D canvas context unavailable");

// Fit the fixed 1280x720 stage into the window, preserving 16:9, and back the
// canvas at the device pixel ratio so the whole stage is visible and crisp — on
// load, before any input, and at any window size. specs/overview.md.
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

async function main(): Promise<void> {
  const assets = await loadAssets();
  const input = new Input();
  input.attach();
  const game = new Game(input, assets);

  // Expose the live game for the Playwright proof-capture script. Inert during
  // normal play.
  (window as unknown as { __spectra?: Game }).__spectra = game;

  let last = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

    game.handleInput();

    accumulator += dt;
    while (accumulator >= FIXED_STEP) {
      game.fixedStep(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
    game.updateVisual(dt);

    // Render in logical space; the transform maps it to the backing store.
    const sx = canvas.width / FIELD_W;
    const sy = canvas.height / FIELD_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    render(ctx!, game);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
