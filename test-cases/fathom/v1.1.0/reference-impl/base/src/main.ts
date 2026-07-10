// Fathom — bootstrap. Fits the fixed 1280x720 stage into the window
// (letterboxed, centered, crisp at any pixel density), loads the provided art,
// wires input, and runs a fixed-timestep simulation decoupled from rendering
// (specs/movement.md).

import { loadAssets } from "./assets";
import { FIXED_STEP, MONO, STAGE_H, STAGE_W } from "./constants";
import { Game } from "./game";
import { Input } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Fathom: 2D canvas context unavailable");

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

function drawLoading(): void {
  ctx!.setTransform(
    canvas.width / STAGE_W,
    0,
    0,
    canvas.height / STAGE_H,
    0,
    0,
  );
  ctx!.fillStyle = "#03060c";
  ctx!.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx!.fillStyle = "#46f0e0";
  ctx!.textAlign = "center";
  ctx!.font = `24px ${MONO}`;
  ctx!.fillText("FATHOM", STAGE_W / 2, STAGE_H / 2 - 10);
  ctx!.fillStyle = "#8a94a6";
  ctx!.font = `14px ${MONO}`;
  ctx!.fillText("descending…", STAGE_W / 2, STAGE_H / 2 + 20);
}

drawLoading();

loadAssets()
  .then((assets) => {
    const input = new Input();
    input.attach();
    const game = new Game(input, assets);

    // Expose the live game for any external tooling (proof capture). Inert.
    (window as unknown as { __fathom?: Game }).__fathom = game;

    let last = performance.now();
    let acc = 0;

    function frame(now: number): void {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25; // avoid a spiral of death after a stall

      game.handleInput(); // once-per-frame edge input

      acc += dt;
      let steps = 0;
      while (acc >= FIXED_STEP && steps < 8) {
        game.fixedStep(FIXED_STEP);
        acc -= FIXED_STEP;
        steps++;
      }
      if (steps === 8) acc = 0; // shed backlog

      const sx = canvas.width / STAGE_W;
      const sy = canvas.height / STAGE_H;
      ctx!.setTransform(sx, 0, 0, sy, 0, 0);
      render(ctx!, game);

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  })
  .catch((err) => {
    console.error(err);
    ctx!.fillStyle = "#ff7a59";
    ctx!.textAlign = "center";
    ctx!.font = `16px ${MONO}`;
    ctx!.fillText("Failed to load art assets.", STAGE_W / 2, STAGE_H / 2 + 60);
  });
