// Carom — this build's look.
//
// The specification leaves the palette, the type, the HUD layout, and the
// tagline to the build (specs/overview.md), so none of this is a spec figure:
// everything the specification does fix lives in `src/constants.ts`. What is here
// is one neon-on-charcoal theme, named once so the renderer and the page agree.

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
