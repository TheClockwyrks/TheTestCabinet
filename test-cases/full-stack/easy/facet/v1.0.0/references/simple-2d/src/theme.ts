// Facet — the look: the palette, the type, and the few geometry figures the
// chrome is laid out against.
//
// Facet fixes no palette and no font (specs/board.md, specs/ui.md), so every
// value here is this build's choice. The choice is a LAPIDARY'S BENCH after
// dark: a warm near-black ground, brass and candle-gold for the chrome, and
// the produced sprites carrying every hue on the board. Nothing in the game's
// logic reads anything from this file; it is read by the renderer alone.
//
// The board itself is a produced sprite (`gems/frame.png`, 648 x 648), and the
// figures below place it so that its felt field lands exactly on the cell
// centers `specs/board.md` fixes.

import {
  BOARD_CX,
  BOARD_CY,
  CELL_PITCH,
  GRID_COLS,
  GRID_ROWS,
} from "./constants";

/** The sprites are drawn on a 64 x 64 canvas at native size (specs/assets.md). */
export const SPRITE_SIZE = 64;

/** The board frame sprite's size, and where its top-left corner sits. */
export const FRAME_SIZE = 648;
/** The felt field the eight-by-eight grid sits on, inside the frame. */
export const FIELD_SIZE = GRID_COLS * CELL_PITCH;
/** The bench surround between the field's edge and the frame's. */
export const FRAME_MARGIN = (FRAME_SIZE - FIELD_SIZE) / 2;

/** The frame's top-left corner on the stage, from the field it must land on. */
export const FRAME_X = BOARD_CX - (GRID_COLS * CELL_PITCH) / 2 - FRAME_MARGIN;
export const FRAME_Y = BOARD_CY - (GRID_ROWS * CELL_PITCH) / 2 - FRAME_MARGIN;

/** The colors the chrome is drawn in. */
export const COLOR = {
  /** The stage ground, which the letterbox bars also carry. */
  bg: "#120d16",
  /** The wash behind the board, lighter toward the middle of the stage. */
  glowInner: "rgba(86, 60, 118, 0.42)",
  glowOuter: "rgba(18, 13, 22, 0)",
  /** Body text and labels. */
  text: "#f2e3c4",
  textDim: "#9c8c78",
  /** Headings, the highlighted menu item, and the brass rules. */
  gold: "#f6c66a",
  goldDim: "#8d6f36",
  /** The mark on the cell the player has hold of. */
  selection: "#7ff0d8",
  /** The mark on the cell that gem is currently offered into. */
  offer: "#f6c66a",
  /** The mark a refused swap leaves on its two cells. */
  refusal: "#ff6a6a",
  /** The level meter. */
  meterTrack: "rgba(255, 236, 200, 0.14)",
  meterFill: "#f6c66a",
  /** The scrim a menu screen lays over the board behind it. */
  scrim: "rgba(12, 8, 16, 0.76)",
  /** A panel behind menu copy. */
  panel: "rgba(24, 17, 30, 0.92)",
  panelEdge: "rgba(246, 198, 106, 0.5)",
} as const;

/**
 * One hue per kind, used ONLY by the loading fallback in `src/render.gems.ts`
 * for the handful of frames before a kind's produced sprite has arrived. The
 * gems a player sees are the sprites; these are what a cell reads as while the
 * page is still fetching them.
 */
export const KIND_FALLBACK: Readonly<Record<string, string>> = {
  ruby: "#d8365b",
  amber: "#e8963c",
  citrine: "#e6d24a",
  jade: "#3fb469",
  beryl: "#48c9c0",
  sapphire: "#4b64d8",
  amethyst: "#9b57c9",
};

/** The type stack: no web font is fetched, so the stage draws in what is here. */
export const FONT_DISPLAY =
  '"Trebuchet MS", "Gill Sans", system-ui, sans-serif';
export const FONT_BODY = "system-ui, Helvetica, Arial, sans-serif";
export const FONT_NUMERIC =
  '"DejaVu Sans Mono", "SF Mono", Menlo, Consolas, monospace';

/** A font shorthand, since every call site wants weight, size, and family. */
export function font(size: number, weight = 400, family = FONT_BODY): string {
  return `${weight} ${size}px ${family}`;
}

/**
 * Draw `text` with letters spaced by `tracking` logical units, centered on `x`.
 *
 * Canvas's own `letterSpacing` is recent and not everywhere, and the headings
 * want the wide, engraved spacing of a shop sign, so the advance is walked by
 * hand. Returns the width the text occupied.
 */
export function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): number {
  const widths = [...text].map((glyph) => ctx.measureText(glyph).width);
  const total =
    widths.reduce((sum, width) => sum + width, 0) +
    tracking * Math.max(0, text.length - 1);
  const previousAlign = ctx.textAlign;
  ctx.textAlign = "left";
  let cursor = x - total / 2;
  [...text].forEach((glyph, index) => {
    ctx.fillText(glyph, cursor, y);
    cursor += widths[index] + tracking;
  });
  ctx.textAlign = previousAlign;
  return total;
}

/**
 * One on-screen control, drawn to fill the pointer target `src/core/targets.ts`
 * reports for it, so what a player presses and what the game hit-tests are one
 * rectangle rather than two sets of numbers that agree until one is edited.
 *
 * `specs/controls.md` fixes the floor a target is sized to, and the two this
 * game carries — `PAUSE` on the board and `BACK` on how-to-play — each read as
 * a pressable plate with its one word centered in it.
 */
export function drawControl(
  ctx: CanvasRenderingContext2D,
  rect: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  },
  label: string,
): void {
  ctx.save();
  ctx.fillStyle = COLOR.panel;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
  ctx.fill();
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.lineWidth = 2;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
  ctx.stroke();

  ctx.font = font(20, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  ctx.textBaseline = "alphabetic";
  drawTracked(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 7, 6);
  ctx.restore();
}

/** A rounded rectangle path, which the panels and the meter are drawn from. */
export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
