// Carom — this build's look: the palette, the type, and the HUD layout.
//
// None of this is fixed by the specification. specs/overview.md states only
// what must be visible (a dark field, solid bodies in bright colors told apart
// from the field and from each other, the scores near the top, a label naming
// the mode) and leaves the look to the build, so every figure here is this
// build's own choice and lives apart from the case-fixed `src/constants.ts`.

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
 * A system monospace stack: no downloaded web font, so the game renders
 * identically offline and fetches nothing at runtime.
 */
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- HUD layout ----------------------------------------------------------

export const SCORE_P1_X = 520; // center x of player one's score, left of center
export const SCORE_P2_X = 760; // center x of player two's score, right of center
export const SCORE_TOP_Y = 40;
export const SCORE_FONT_PX = 76;

// ---- Copy the specification leaves to the build --------------------------

export const TAGLINE_TEXT = "NEON PADDLE DUEL";

/** The label naming the mode, drawn on the field during a match. */
export const MODE_LABEL = { solo: "SOLO", versus: "VERSUS" } as const;

/**
 * The how-to screen's single menu item. specs/ui.md fixes that the screen shows
 * one, at index `0`, drawn as the other menus draw the item at `menuIndex`, and
 * leaves the copy to the build.
 */
export const HOWTO_ITEMS = ["BACK"] as const;

// ---- The two centered panels ---------------------------------------------
//
// Their size is what places the menus inside them, so `src/menus.ts` reads these
// rather than repeating the arithmetic.

/** The pause panel, centered on the field. */
export const PAUSE_PANEL = { w: 520, h: 400 } as const;

/** The match-over panel, centered on the field. */
export const MATCHOVER_PANEL = { w: 560, h: 420 } as const;
