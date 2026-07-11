// Meltdown — build-panel layout. These rects are the single source of truth for
// both the renderer (render.ts) and hit-testing (game.ts), all in logical pixels
// on the fixed 1280x720 stage. Menu-overlay item rects are laid out by the
// renderer and stashed on the Game for click hit-testing.

import { PANEL_X, PANEL_W, STAGE_H } from "./constants";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

const PAD = 16;
export const PANEL_INNER_X = PANEL_X + PAD; // 1016
export const PANEL_INNER_W = PANEL_W - 2 * PAD; // 248
export const PANEL_INNER_R = PANEL_INNER_X + PANEL_INNER_W; // 1264

// Readouts strip.
export const READOUTS_Y = 18;
export const READOUTS_H = 44;

// Shop grid (4 columns x 2 rows). Sits below the readouts + phase-progress read.
export const SHOP_TITLE_Y = 112;
export const SHOP_Y = 122;
export const SHOP_GAP = 8;
export const SHOP_COL_W = (PANEL_INNER_W - 3 * SHOP_GAP) / 4; // 56
export const SHOP_ROW_H = SHOP_COL_W; // square

export function shopItemRect(index: number): Rect {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: PANEL_INNER_X + col * (SHOP_COL_W + SHOP_GAP),
    y: SHOP_Y + row * (SHOP_ROW_H + SHOP_GAP),
    w: SHOP_COL_W,
    h: SHOP_ROW_H,
  };
}

// Inspector / next-wave panel box.
export const INSPECTOR: Rect = { x: PANEL_INNER_X, y: 254, w: PANEL_INNER_W, h: 344 };

export function upgradeBtnRect(): Rect {
  const w = (PANEL_INNER_W - SHOP_GAP) / 2;
  return { x: INSPECTOR.x, y: INSPECTOR.y + INSPECTOR.h - 44, w, h: 32 };
}
export function sellBtnRect(): Rect {
  const w = (PANEL_INNER_W - SHOP_GAP) / 2;
  return { x: INSPECTOR.x + w + SHOP_GAP, y: INSPECTOR.y + INSPECTOR.h - 44, w, h: 32 };
}
// Rotate button, sitting just above the upgrade/sell row (emitters only).
export function rotateBtnRect(): Rect {
  return { x: INSPECTOR.x, y: INSPECTOR.y + INSPECTOR.h - 84, w: PANEL_INNER_W, h: 30 };
}

// Wave controls, pinned to the bottom.
const BOTTOM_PAD = 18;
export const CTL_H = 34;
export const CTL_Y = STAGE_H - BOTTOM_PAD - CTL_H; // 668
export const SEND_H = 46;
export const SEND_Y = CTL_Y - SHOP_GAP - SEND_H; // 614

export function sendBtnRect(): Rect {
  return { x: PANEL_INNER_X, y: SEND_Y, w: PANEL_INNER_W, h: SEND_H };
}

export function ctlRect(index: number): Rect {
  const w = (PANEL_INNER_W - 2 * SHOP_GAP) / 3;
  return { x: PANEL_INNER_X + index * (w + SHOP_GAP), y: CTL_Y, w, h: CTL_H };
}
