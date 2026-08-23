// Carom — this build's look.
//
// The specification fixes what must be visible (a dark field, bright bodies that
// stand apart from it and from each other, the scores near the top, a mode
// label) and leaves the look itself to the build. Everything below is that look:
// the neon-on-charcoal palette, the type, and where the HUD sits. None of it is
// read by the simulation, and none of it is a figure the specification names.

/** The palette. `bg` is the field background the engine clears the canvas to. */
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
 * identically offline.
 */
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- HUD layout ----------------------------------------------------------

export const SCORE_P1_X = 520; // center x of player one's score
export const SCORE_P2_X = 760; // center x of player two's score
export const SCORE_TOP_Y = 40;
export const SCORE_FONT_PX = 76;

// ---- Copy the specification leaves to the build --------------------------

export const TAGLINE_TEXT = "NEON PADDLE DUEL";

/** The label naming the mode, drawn on the field during a match. */
export const MODE_LABEL = { solo: "SOLO", versus: "VERSUS" } as const;
