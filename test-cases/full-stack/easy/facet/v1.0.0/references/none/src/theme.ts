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
 * The felt field's own top-left corner, inside the bench surround. It is what
 * the board is drawn through: a stone still falling in from above the top row
 * is hidden behind the bench until it crosses this edge, so it arrives ONTO the
 * field rather than over the frame around it.
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
  /** The mark on the held gem, and the lighter one on the cell it is offered
   * into. */
  selection: "#7ff0d8",
  offer: "#fff4d2",
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
  /**
   * A pointer target's own plate: the fill and edge that make its rectangle
   * visible, and the brighter pair the highlighted one takes.
   */
  control: "rgba(48, 34, 60, 0.72)",
  controlEdge: "rgba(246, 198, 106, 0.32)",
  controlLit: "rgba(246, 198, 106, 0.16)",
  controlLitEdge: "#f6c66a",
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

/** A rectangle in logical stage units, which is the shape a pointer target has. */
export interface Plate {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A control drawn to fill a pointer target exactly, with its label centered in
 * it.
 *
 * `specs/controls.md` requires the drawn thing and the rectangle the game
 * hit-tests to be one and the same — "a `menu-<i>` target covers the drawn menu
 * item that `state.menuIndex` `i` highlights", and the `back` and `pause`
 * targets each cover a drawn control carrying their label — so every caller
 * hands this function the rectangle `src/core/targets.ts` reported rather than
 * a rectangle of its own. `highlighted` is what tells a player which item a
 * `confirm`, or a release, would take.
 */
export function drawControl(
  ctx: CanvasRenderingContext2D,
  plate: Plate,
  label: string,
  highlighted: boolean,
  size = 26,
  tracking = 5,
): void {
  ctx.save();
  ctx.fillStyle = highlighted ? COLOR.controlLit : COLOR.control;
  roundedRect(ctx, plate.x, plate.y, plate.w, plate.h, 12);
  ctx.fill();
  ctx.strokeStyle = highlighted ? COLOR.controlLitEdge : COLOR.controlEdge;
  ctx.lineWidth = highlighted ? 3 : 1.5;
  roundedRect(ctx, plate.x, plate.y, plate.w, plate.h, 12);
  ctx.stroke();

  ctx.font = font(size, highlighted ? 700 : 500, FONT_DISPLAY);
  ctx.fillStyle = highlighted ? COLOR.gold : COLOR.text;
  ctx.textBaseline = "middle";
  drawTracked(
    ctx,
    label,
    plate.x + plate.w / 2,
    plate.y + plate.h / 2,
    tracking,
  );
  ctx.restore();
}
