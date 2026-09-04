// Carom — this build's look: the palette, the type, the HUD layout, and the
// geometry of the menus.
//
// None of this is fixed by the specification, which asks only for a dark field,
// bright bodies that stand apart from it and from each other, the scores near the
// top, and a label naming the mode. Everything here is this build's own choice,
// kept apart from `src/constants.ts` so the figures the specification fixes are
// never mixed with the figures that are merely taste.
//
// The menu geometry is here for the same reason and matters more than the rest of
// it: `specs/ui.md` says each menu item occupies "a rectangular hit region the
// build lays out", and `specs/instrumentation.md` says the build REPORTS that
// region through `menuItemRect`. So the numbers below are the single source both
// the renderer and the reading read, and a menu cannot be drawn in one place and
// reported in another.

import { FIELD_CX, FIELD_CY, FIELD_H } from "./constants";

/** Neon on charcoal. */
export const COLOR = {
  bg: "#0b0e14",
  bgRaised: "#11151f",
  p1: "#3ae7c4", // player one / left paddle
  p2: "#ff5c8a", // player two / AI / right paddle
  ball: "#f2f5f7",
  obstacle: "#ffb454",
  net: "#243044",
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
  panelBorder: "#20283a",
} as const;

/**
 * The field background: what the runtime clears the canvas to each frame, so the
 * letterbox bars around the field match the field itself.
 */
export const BACKGROUND = COLOR.bg;

/**
 * A system monospace stack: no downloaded web font, so the game renders
 * identically offline.
 */
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- HUD layout ----------------------------------------------------------

export const SCORE_P1_X = 520; // center x of player one's score
export const SCORE_P2_X = 760; // center x of player two's score
export const SCORE_TOP_Y = 40;
export const SCORE_FONT_PX = 76;

// ---- Copy of this build's own --------------------------------------------

export const TAGLINE_TEXT = "NEON PADDLE DUEL";
export const MODE_LABEL = { solo: "SOLO", versus: "VERSUS" } as const;

/**
 * The how-to screen's one menu item (`specs/ui.md` leaves its copy to the build).
 *
 * It is a menu of one, drawn and reported exactly as the other menus draw and
 * report the item at `menuIndex`, so a pointer or a finger leaves the screen the
 * same way `confirm` and `back` do.
 */
export const HOWTO_ITEMS = ["BACK"] as const;

// ---- Menu geometry -------------------------------------------------------

/**
 * Where one menu sits and how big its items are, in the field's logical units.
 *
 * `centerX` and `startY` place the FIRST item's center; each later item is
 * `spacing` further down. `width` and `height` are the hit region around that
 * center, and `height` is deliberately shorter than `spacing` so two regions
 * never overlap and a pointer is over at most one item.
 */
export interface MenuGeometry {
  /** The center x every item is centered on. */
  readonly centerX: number;
  /** The center y of item 0. */
  readonly startY: number;
  /** The vertical distance between two items' centers. */
  readonly spacing: number;
  /** The hit region's width. */
  readonly width: number;
  /** The hit region's height. */
  readonly height: number;
  /** The type size the item is drawn at. */
  readonly fontPx: number;
  /** The letter spacing the item is drawn with. */
  readonly letterSpacing: number;
}

/** The pause panel, centered on the field. */
export const PAUSE_PANEL = { w: 520, h: 400 } as const;

/** The match-over panel, centered on the field. */
export const MATCHOVER_PANEL = { w: 560, h: 420 } as const;

/** The top-left corner of a panel of this size, centered on the field. */
export function panelTop(height: number): number {
  return FIELD_CY - height / 2;
}

export const TITLE_MENU: MenuGeometry = {
  centerX: FIELD_CX,
  startY: 430,
  spacing: 52,
  width: 420,
  height: 44,
  fontPx: 30,
  letterSpacing: 10,
};

export const HOWTO_MENU: MenuGeometry = {
  centerX: FIELD_CX,
  startY: FIELD_H - 44,
  spacing: 52,
  width: 420,
  height: 44,
  fontPx: 24,
  letterSpacing: 8,
};

export const PAUSE_MENU: MenuGeometry = {
  centerX: FIELD_CX,
  startY: panelTop(PAUSE_PANEL.h) + 200,
  spacing: 52,
  width: 400,
  height: 44,
  fontPx: 26,
  letterSpacing: 6,
};

export const MATCHOVER_MENU: MenuGeometry = {
  centerX: FIELD_CX,
  startY: panelTop(MATCHOVER_PANEL.h) + 268,
  spacing: 52,
  width: 400,
  height: 44,
  fontPx: 26,
  letterSpacing: 6,
};
