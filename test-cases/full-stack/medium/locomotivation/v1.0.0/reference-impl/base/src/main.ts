// Locomotivation — entry point.
//
// Boots the game: grabs the canvas, fits the fixed 1280x720 logical stage into the window
// with a centered, aspect-preserving letterbox (the whole stage is always visible,
// specs/overview.md), loads the PRODUCED assets, then hands a logical-space 2D context to
// the Game orchestrator. Everything is page-relative and self-contained (no network at
// runtime beyond fetching the committed asset files).

import { STAGE_H, STAGE_W } from "./constants";
import { loadAssets } from "./assets";
import { Game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Missing #stage canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Canvas 2D context unavailable");

/**
 * Size the canvas to the window (device pixels) and set a base transform that maps the
 * 1280x720 logical stage into a centered letterbox. The game draws in logical coordinates;
 * this establishes the mapping. Implementation may reset this per-frame in render.ts, but
 * the fit is owned here so resizing is a single concern.
 */
function fitCanvas(context: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  canvas!.width = Math.round(cw * dpr);
  canvas!.height = Math.round(ch * dpr);
  canvas!.style.width = `${cw}px`;
  canvas!.style.height = `${ch}px`;

  const scale = Math.min((cw * dpr) / STAGE_W, (ch * dpr) / STAGE_H);
  const offsetX = (cw * dpr - STAGE_W * scale) / 2;
  const offsetY = (ch * dpr - STAGE_H * scale) / 2;
  context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
}

fitCanvas(ctx);
window.addEventListener("resize", () => fitCanvas(ctx));

loadAssets().then((assets) => {
  const game = new Game(ctx, assets);
  game.start();
});
