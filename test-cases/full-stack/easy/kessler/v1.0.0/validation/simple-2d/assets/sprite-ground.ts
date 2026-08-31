// assets/sprite-ground — reading a produced sprite's alpha off disk.
//
// specs/assets.md fixes the produced sprite set as FILES — the sprite table
// names `assets/sprites/planet.png`, the five pod sprites under
// `assets/sprites/pods/`, and the six ball frames `assets/sprites/ball/0.png`
// to `5.png` — and requires each "on a transparent, straight-alpha canvas".
// This module decodes those committed bytes to RGBA, reports how much of each
// canvas is ground rather than paint, and paints the checkerboard evidence
// picture that shows the transparency. Nothing here touches the game.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { WORKSPACE } from "./media-out";

/**
 * Every produced sprite, by the exact paths the table in specs/assets.md
 * lands them at, with the canvas size the table states for each.
 */
export const SPRITES = [
  { label: "planet", path: "assets/sprites/planet.png", size: 160 },
  { label: "widen", path: "assets/sprites/pods/widen.png", size: 24 },
  { label: "narrow", path: "assets/sprites/pods/narrow.png", size: 24 },
  { label: "multiball", path: "assets/sprites/pods/multiball.png", size: 24 },
  { label: "shield", path: "assets/sprites/pods/shield.png", size: 24 },
  { label: "pierce", path: "assets/sprites/pods/pierce.png", size: 24 },
  { label: "ball 0", path: "assets/sprites/ball/0.png", size: 24 },
  { label: "ball 1", path: "assets/sprites/ball/1.png", size: 24 },
  { label: "ball 2", path: "assets/sprites/ball/2.png", size: 24 },
  { label: "ball 3", path: "assets/sprites/ball/3.png", size: 24 },
  { label: "ball 4", path: "assets/sprites/ball/4.png", size: 24 },
  { label: "ball 5", path: "assets/sprites/ball/5.png", size: 24 },
] as const;

/** One decoded sprite: its pixels and what its alpha channel holds. */
export interface SpriteRead {
  width: number;
  height: number;
  /** Share of pixels whose alpha is at most 32 of 255 — clear ground. */
  groundShare: number;
  /** The smallest alpha any pixel carries. */
  minAlpha: number;
}

/** Decode the sprite at `path` (workspace-relative), or throw with the reason. */
export async function readSprite(path: string): Promise<SpriteRead> {
  const image = await loadImage(readFileSync(join(WORKSPACE, path)));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  let ground = 0;
  let minAlpha = 255;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    if (alpha <= 32) ground++;
    if (alpha < minAlpha) minAlpha = alpha;
  }
  return {
    width: image.width,
    height: image.height,
    groundShare: ground / (data.length / 4),
    minAlpha,
  };
}

/**
 * Every sprite composited over a checkerboard at 4x, the standard way a
 * transparent ground is shown: wherever the checker shows through, the canvas
 * was transparent there.
 */
export async function paintCheckerboard(): Promise<Canvas> {
  const scale = 4;
  const pad = 16;
  const cell = 24 * scale + pad;
  const canvas = createCanvas(1200, 560);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const checker = (x: number, y: number, w: number, h: number): void => {
    for (let cy = 0; cy < h; cy += 8) {
      for (let cx = 0; cx < w; cx += 8) {
        ctx.fillStyle = ((cx + cy) / 8) % 2 === 0 ? "#3a3f46" : "#585f68";
        ctx.fillRect(x + cx, y + cy, Math.min(8, w - cx), Math.min(8, h - cy));
      }
    }
  };
  ctx.imageSmoothingEnabled = false;
  ctx.font = "13px sans-serif";
  // The planet at 2x on the left, the eleven small sprites at 4x in two rows.
  const planet = SPRITES[0];
  checker(pad, pad, 160 * 2, 160 * 2);
  const planetImage = await loadImage(
    readFileSync(join(WORKSPACE, planet.path)),
  );
  ctx.drawImage(planetImage, pad, pad, 160 * 2, 160 * 2);
  ctx.fillStyle = "#e8ecf2";
  ctx.fillText(planet.label, pad, pad + 160 * 2 + 18);
  let x = pad + 160 * 2 + pad * 2;
  let y = pad;
  for (const sprite of SPRITES.slice(1)) {
    checker(x, y, 24 * scale, 24 * scale);
    const image = await loadImage(readFileSync(join(WORKSPACE, sprite.path)));
    ctx.drawImage(image, x, y, 24 * scale, 24 * scale);
    ctx.fillStyle = "#e8ecf2";
    ctx.fillText(sprite.label, x, y + 24 * scale + 18);
    x += cell;
    if (x + 24 * scale > canvas.width - pad) {
      x = pad + 160 * 2 + pad * 2;
      y += 24 * scale + pad * 3;
    }
  }
  return canvas;
}
