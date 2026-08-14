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

    // Advance the simulation from the wall clock only while the game owns its own
    // clock (normal play, the default). When the debug API has taken over the clock
    // (game.autoStep === false), the loop still renders every frame but leaves the
    // stepping to the debug API's step(ticks), so a scripted scenario advances by
    // exactly what it asks for. See game.ts / debug.ts.
    if (game.autoStep) {
      accumulator += dt;
      while (accumulator >= FIXED_STEP) {
        game.fixedStep(FIXED_STEP);
        accumulator -= FIXED_STEP;
      }
    } else {
      accumulator = 0; // don't bank real time while the debug API holds the clock
    }

    // What is left in the accumulator is time the display is showing but the
    // simulation has not stepped through yet. Hand it to the renderer as a
    // fraction of a step so it can draw between the last two states: the tick
    // rate and the refresh rate do not divide evenly, so the number of steps per
    // frame varies, and drawing the raw state would move everything by a
    // different distance each frame. Zero while the debug API holds the clock, so
    // a posed scenario is drawn exactly as it was stepped.
    game.renderAlpha = game.autoStep ? accumulator / FIXED_STEP : 0;

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    render(ctx!, game, sprites);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
