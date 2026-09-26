// Fathom — this build's look.
//
// `specs/overview.md` leaves the palette, the type, the glow and the layout of
// each screen to the build, so nothing here is a specification figure:
// everything the specification does fix lives in `src/constants.ts`. What is
// here is one bioluminescence-in-the-abyss theme, named once so the renderer and
// the page agree on it.

/** The palette. Cold light glowing out of a near-black trench. */
export const COLOR = {
  /** Unrevealed fog, the stage background, and the letterbox bars. */
  fog: "#03060c",
  /** Raised panel fill and its border, for the menus drawn over the maze. */
  panel: "#0a1018",
  panelBorder: "#16293d",
  forager: "#46f0e0",
  plankton: "#b8f5c8",
  /** The forager's own sonar pulse. */
  sonar: "#5ef2ff",
  /** The Lanternjaw, its bulb, and the bonus drifter: one amber for both. */
  amber: "#ffd166",
  amberCore: "#fff3cf",
  gloamfin: "#c46bff",
  flarefish: "#ff7a59",
  ink: "#0b0a1f",
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
} as const;

/**
 * The three wavefront tints, as bare `r,g,b` triples so an alpha can be varied
 * per arc of the drawn crest. `specs/state.md` names which tint belongs to
 * which pulse.
 */
export const PULSE_RGB = {
  cyan: "94,242,255",
  violet: "196,107,255",
  orange: "255,150,60",
} as const;

/**
 * A system monospace stack: no downloaded web font, so the game renders the same
 * with no network.
 */
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- HUD layout ----------------------------------------------------------

/** The top strip is y in [0, 80] and the bottom strip y in [656, 720]. */
export const HUD_TOP_H = 80;
export const HUD_BOTTOM_Y = 656;

/** The inset the HUD's outermost elements sit at, on both sides. */
export const HUD_MARGIN = 40;

/** The score's cap height, which `specs/ui.md` fixes at about 48 units. */
export const SCORE_FONT_PX = 48;

/** How many digits the score is padded to, so its width does not jump. */
export const SCORE_DIGITS = 5;

// ---- Timings this build chooses ------------------------------------------

/**
 * The dive countdown: three numbers, each held this long, so the whole hold is
 * 2.1 s — inside the 1 s to 3 s window `specs/ui.md` fixes.
 */
export const COUNTDOWN_NUMBERS = 3;
export const COUNTDOWN_STEP = 0.7;

/** The cleared interstitial's hold, inside the same 1 s to 3 s window. */
export const CLEARED_HOLD = 1.6;

/** How many body frames a swim cycle plays per second. */
export const SWIM_FPS = 8;

// ---- The drawn wavefront -------------------------------------------------

/**
 * How far behind its leading edge a wavefront still reads as light, in corridor
 * steps. It is the width of the drawn crest and, with it, the band of tiles the
 * pulse holds lit as it passes.
 */
export const PULSE_BAND = 2.6;
