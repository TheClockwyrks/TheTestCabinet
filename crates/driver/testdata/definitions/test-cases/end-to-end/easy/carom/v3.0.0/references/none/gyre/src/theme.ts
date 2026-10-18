// Carom — this build's look.
//
// The specification leaves the palette, the type, the HUD layout, and the
// tagline to the build (specs/overview.md), and these are this build's choices:
// neon on charcoal, a system monospace, the scores either side of the net near
// the top. Nothing here is a figure the specification fixes; those live in
// `src/constants.ts`, and the two are kept apart on purpose.

/** The palette, as CSS colors. */
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

// ---- HUD layout, in logical units ----------------------------------------

export const SCORE_P1_X = 520; // center x of player one's score, left of center
export const SCORE_P2_X = 760; // center x of player two's score, right of center
export const SCORE_TOP_Y = 40;
export const SCORE_FONT_PX = 76;

// ---- Screen copy the specification leaves to the build --------------------

export const TAGLINE_TEXT = "NEON PADDLE DUEL";
export const MODE_LABEL = { solo: "SOLO", versus: "VERSUS" } as const;

/**
 * The how-to screen's single menu item.
 *
 * `specs/ui.md` fixes that the screen shows ONE item at index `0` and that
 * confirming it returns to the title; the copy is this build's, so it lives here
 * beside the tagline rather than among the figures the specification fixes.
 */
export const HOWTO_ITEM_TEXT = "BACK TO TITLE";
