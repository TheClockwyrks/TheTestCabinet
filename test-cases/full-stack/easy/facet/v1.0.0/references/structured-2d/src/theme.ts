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

/**
 * The felt field's own top-left corner, which is the board's drawn extent. A
 * stone on its way down comes from above the board's top row
 * (specs/rules.md), so the stones are drawn clipped to this rectangle and a
 * falling stone rises out of the bench's edge rather than over it.
 */
export const FIELD_X = FRAME_X + FRAME_MARGIN;
export const FIELD_Y = FRAME_Y + FRAME_MARGIN;

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
  /** The ring that marks the cell the player has hold of. */
  selection: "#7ff0d8",
  /** The plate a menu row and an on-screen control are drawn on. */
  plate: "rgba(52, 38, 66, 0.55)",
  plateEdge: "rgba(246, 198, 106, 0.22)",
  platePicked: "rgba(246, 198, 106, 0.16)",
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

/** A rectangle in stage units, which is the shape a pointer target has. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The plate a menu row and an on-screen control are drawn on.
 *
 * It is drawn at the rectangle it is given rather than around the text, because
 * that rectangle is the pointer target `src/core/targets.ts` hit-tests against
 * (specs/controls.md) — so what a player presses is exactly what they see, and
 * a fingertip has the whole of it to land on. The edge is stroked INSIDE that
 * rectangle rather than centered on it, so the drawn row falls wholly within
 * the target it stands for and never a pixel beyond it.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  picked: boolean,
): void {
  ctx.fillStyle = picked ? COLOR.platePicked : COLOR.plate;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 12);
  ctx.fill();
  const width = picked ? 2 : 1;
  ctx.strokeStyle = picked ? COLOR.gold : COLOR.plateEdge;
  ctx.lineWidth = width;
  roundedRect(
    ctx,
    rect.x + width / 2,
    rect.y + width / 2,
    rect.w - width,
    rect.h - width,
    12 - width / 2,
  );
  ctx.stroke();
}

/**
 * One on-screen control — the `PAUSE` and `BACK` targets `specs/controls.md`
 * names — drawn on its own rectangle with its word centered in it.
 */
export function drawControl(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawPlate(ctx, rect, false);
  ctx.font = font(20, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 7, 5);
  ctx.restore();
}
