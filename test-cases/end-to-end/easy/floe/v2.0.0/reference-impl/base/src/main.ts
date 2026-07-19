// Floe — bootstrap. Loads the sprite art, fits the fixed 1280x720 stage into the
// window (letterboxed and centered at any size / pixel density), wires input, and
// runs a fixed-timestep loop: the simulation advances in fixed FIXED_STEP
// increments decoupled from rendering.

import { loadSprites, type Sprites } from "./assets";
import { FIXED_STEP, MONO, STAGE_H, STAGE_W } from "./constants";
import { installDebugApi } from "./debug";
import { Game } from "./game";
import { Input } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Floe: 2D canvas context unavailable");

// Fit the fixed 1280x720 stage into the window, preserving 16:9, backed at the
// device pixel ratio so it stays crisp on any display.
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const cssW = Math.max(1, Math.round(STAGE_W * scale));
  const cssH = Math.max(1, Math.round(STAGE_H * scale));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  if (ctx) ctx.imageSmoothingEnabled = false;
}

window.addEventListener("resize", resize);
resize();

function loadingScreen(msg: string): void {
  if (!ctx) return;
  const sx = canvas.width / STAGE_W;
  const sy = canvas.height / STAGE_H;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.fillStyle = "#061a28";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.fillStyle = "#8fb6c9";
  ctx.font = `18px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(msg, STAGE_W / 2, STAGE_H / 2);
  ctx.textAlign = "left";
}

loadingScreen("LOADING…");

void start();

async function start(): Promise<void> {
  let sprites: Sprites;
  try {
    sprites = await loadSprites();
  } catch (err) {
    loadingScreen("FAILED TO LOAD ART");
    throw err;
  }

  const input = new Input();
  input.attach();
  const game = new Game(input);
  // Install the debugging and automation API on window.__floe (see debug.ts and
  // specs/instrumentation.md). Inert during normal play.
  installDebugApi(game);

  let last = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a long stall

    game.handleInput(); // once-per-frame edge input (menus, pause, mute)

    accumulator += dt;
    while (accumulator >= FIXED_STEP) {
      game.fixedStep(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    render(ctx!, game, sprites);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
