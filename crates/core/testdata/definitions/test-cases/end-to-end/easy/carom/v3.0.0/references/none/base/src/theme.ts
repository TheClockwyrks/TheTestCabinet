// Carom — this build's look, and the layout that goes with it.
//
// The specification leaves the palette, the type, the HUD layout, the how-to
// copy, and where a menu sits to the build (specs/overview.md, specs/ui.md), so
// none of this is a spec figure: everything the specification does fix lives in
// `src/constants.ts`. What is here is one neon-on-charcoal theme, named once so
// the renderer, the menu geometry, and the page agree.
//
// The menu geometry is here for that reason. `src/menus.ts` turns it into the hit
// regions a pointer selects an item from and `src/render.ts` draws the items at
// exactly those regions, so the layout a player sees and the layout
// `menuItemRect` reports are the same layout.

import { FIELD_CX, FIELD_CY, FIELD_H } from "./constants";

/** The palette. Each moving body is bright against the dark field. */
export const COLOR = {
  /** The field background, and the color the runtime clears the canvas to. */
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

// ---- Screen copy of this build's own -------------------------------------

export const TAGLINE_TEXT = "NEON PADDLE DUEL";
export const MODE_LABEL = { solo: "SOLO", versus: "VERSUS" } as const;

/**
 * The how-to screen's one menu item (specs/ui.md leaves its copy to the build).
 * It is a list of one so every menu screen is described the same way.
 */
export const HOWTO_ITEMS = ["BACK TO MENU"] as const;

// ---- Menu layout ---------------------------------------------------------

/** The two panels the pause and match-over menus are laid out inside. */
export const PAUSE_PANEL = { w: 520, h: 400 } as const;
export const MATCHOVER_PANEL = { w: 560, h: 420 } as const;

/** The top edge of a centered panel of height `h`. */
export function panelTop(h: number): number {
  return FIELD_CY - h / 2;
}

/**
 * Where one menu's items sit and how large the region around each one is.
 *
 * `centerX` and `firstY` are the center of the first item; each item after it is
 * `spacing` lower. `hitW` and `hitH` size the rectangle centered on an item that
 * a pointer or a finger selects it from — wider than the text, so a player aiming
 * at a word hits it, and shorter than `spacing`, so two items never overlap.
 */
export interface MenuStyle {
  centerX: number;
  firstY: number;
  spacing: number;
  /** Font size of an item, in logical units. */
  size: number;
  /** Extra tracking between glyphs, in logical units. */
  letterSpacing: number;
  hitW: number;
  hitH: number;
}

/** The title menu, under the title and the tagline. */
export const TITLE_MENU: MenuStyle = {
  centerX: FIELD_CX,
  firstY: 430,
  spacing: 52,
  size: 30,
  letterSpacing: 10,
  hitW: 460,
  hitH: 46,
};

/** The how-to screen's single item, along the bottom of the page. */
export const HOWTO_MENU: MenuStyle = {
  centerX: FIELD_CX,
  firstY: FIELD_H - 44,
  spacing: 52,
  size: 20,
  letterSpacing: 8,
  hitW: 420,
  hitH: 44,
};

/** The pause menu, inside the pause panel. */
export const PAUSE_MENU: MenuStyle = {
  centerX: FIELD_CX,
  firstY: panelTop(PAUSE_PANEL.h) + 200,
  spacing: 52,
  size: 26,
  letterSpacing: 6,
  hitW: 420,
  hitH: 44,
};

/** The match-over menu, inside the match-over panel. */
export const MATCHOVER_MENU: MenuStyle = {
  centerX: FIELD_CX,
  firstY: panelTop(MATCHOVER_PANEL.h) + 268,
  spacing: 52,
  size: 26,
  letterSpacing: 6,
  hitW: 440,
  hitH: 44,
};
