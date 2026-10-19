// Carom — this build's look: the palette, the type, the render layers, and the
// HUD layout.
//
// None of this is fixed by the specification. specs/overview.md states only
// what must be visible (a dark field, solid bodies in bright colors told apart
// from the field and from each other, the scores near the top, a label naming
// the mode) and leaves the look to the build, so every figure here is this
// build's own choice and lives apart from the case-fixed `src/constants.ts`.

import type { Screen } from "./state";

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

// ---- Render layers -------------------------------------------------------
//
// The engine's pipeline draws every render component in `layer` order, lowest
// first. Numbering them once, with gaps, is what keeps the picture stacked the
// same way from every actor: field furniture, then the ball's trail beneath the
// ball, then the HUD, then whichever screen chrome sits over the field.

export const LAYER = {
  net: 0,
  obstacles: 2,
  paddles: 4,
  trail: 6,
  ball: 8,
  hud: 12,
  chrome: 16,
} as const;

// ---- Screen dim ----------------------------------------------------------

/**
 * How brightly the field furniture is drawn on each screen. The menus sit over
 * a dimmed field; a live match (and the pause screen, whose veil darkens
 * separately) draws it in full.
 */
export const FURNITURE_ALPHA: Readonly<Record<Screen, number>> = {
  title: 0.28,
  howto: 0.16,
  countdown: 1,
  playing: 1,
  paused: 1,
  matchover: 0.32,
};

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
 * The participant names on the player states, one per side.
 *
 * They name the SEAT rather than who is in it: which of the two ways to play a
 * match is being played is read from the instance every frame, so the right
 * seat is a person in Versus and the computer in Solo without the world being
 * rebuilt (src/match-mode.ts).
 */
export const PLAYER_NAME = { left: "PLAYER ONE", right: "PLAYER TWO" } as const;
