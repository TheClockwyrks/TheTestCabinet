// Wireworm — this build's look.
//
// The specification fixes no palette, no typeface, and no screen layout
// (specs/overview.md: "The palette, the type, the glow, and every other aspect
// of the look are yours"). It fixes only what a player must be able to READ at a
// glance — the charge ramp, the worm against the field, the cursor against the
// band, the three foes apart from one another. So none of this is a spec figure:
// everything the specification does fix lives in `src/constants.ts`, and what is
// here is one look, named once so the renderer and the page agree.
//
// The look is a dark circuit board under a cold instrument light: teal traces,
// a violet data-worm, and a charge ramp that climbs from slate through teal to a
// white-hot critical.
//
// THE CHARGE RAMP IS DRAWN IN TWO LAYERS AROUND THE SEEDED ART, and that is
// deliberate rather than decorative. `assets/node/` draws charge 0 and charge 1
// with the same core pixels, so the seeded art alone does not separate the
// bottom of the ramp. This build therefore lays a charge-colored HALO behind
// each node and an additive CORE over it, both keyed to the charge, so the four
// states are told apart both by the color of the whole tile and by the color at
// its center. The frames themselves are always the seeded ones.

/** The palette. */
export const COLOR = {
  /** The stage background, which the runtime also clears the letterbox to. */
  bg: "#060a10",
  /** The board field beneath the HUD. */
  board: "#0a121a",
  /** The faint trace grid over the board. */
  grid: "#132430",
  /** The player band: the bottom two rows, read as a distinct floor. */
  band: "#152e38",
  /** The line marking the top of the band. */
  bandEdge: "rgba(90, 226, 199, 0.35)",
  /** The HUD bar and the rule beneath it. */
  hud: "#080e15",
  hudRule: "#1e4450",
  /** Type. */
  text: "#dceef2",
  textDim: "#8fa9b2",
  textFaint: "#4e6873",
  /** The score, the brightest readout on the bar. */
  score: "#7df0d4",
  /** A menu highlight. */
  highlight: "#7df0d4",
  /** A life pip in the HUD. */
  life: "#63d8f5",
  /** A bolt in flight, and the glow around it. */
  bolt: "#eafcff",
  boltGlow: "rgba(99, 216, 245, 0.85)",
  /** A discharge arc. */
  arc: "#d8fff0",
  arcGlow: "rgba(140, 255, 224, 0.9)",
  /** The scrim a menu is laid over the board on. */
  scrim: "rgba(4, 9, 14, 0.66)",
  /** The level banner. */
  banner: "#eafdff",
} as const;

/**
 * A system monospace stack: no downloaded web font, so the game renders
 * identically offline and at any base path.
 */
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** One element's two-layer glow: a halo behind it and an additive core over it. */
export interface Glow {
  /** The halo's color, as `[r, g, b]`. */
  halo: readonly [number, number, number];
  /** The halo's alpha at its center; it fades to nothing at its radius. */
  haloAlpha: number;
  /** How far the halo reaches, in logical units. */
  haloRadius: number;
  /** The core's color, as `[r, g, b]`. It is ADDED to what is already drawn. */
  core: readonly [number, number, number];
  /** How far the core reaches, in logical units. */
  coreRadius: number;
}

/** A node's glow, which adds the solder pad the component sits on. */
export interface NodeGlow extends Glow {
  /** The pad's color, as `[r, g, b]`. */
  pad: readonly [number, number, number];
  /** The pad's alpha. */
  padAlpha: number;
}

/** How far inside its tile a node's pad sits, in logical units. */
export const NODE_PAD_INSET = 2;

/**
 * The charge ramp, one entry per charge `0..3`.
 *
 * Three layers climb together, so the four states differ from one another
 * however they are sampled: the PAD carries most of the tile, which is what a
 * region sample reads; the CORE is added over the sprite's own pixels, which is
 * what a center sample reads; and the halo blooms between them. All three are
 * needed, because `assets/node/` draws charge 0 and charge 1 with the same
 * center pixels and with the same coverage, so neither sample separates them on
 * the seeded art alone.
 */
export const NODE_GLOW: readonly NodeGlow[] = [
  {
    pad: [30, 48, 62],
    padAlpha: 0.55,
    halo: [56, 84, 104],
    haloAlpha: 0.4,
    haloRadius: 15,
    core: [14, 22, 28],
    coreRadius: 10,
  },
  {
    pad: [20, 118, 100],
    padAlpha: 0.55,
    halo: [30, 160, 136],
    haloAlpha: 0.45,
    haloRadius: 15,
    core: [16, 86, 72],
    coreRadius: 10,
  },
  {
    pad: [70, 214, 150],
    padAlpha: 0.55,
    halo: [92, 240, 190],
    haloAlpha: 0.45,
    haloRadius: 15,
    core: [44, 30, 18],
    coreRadius: 10,
  },
  {
    pad: [225, 250, 240],
    padAlpha: 0.55,
    halo: [255, 255, 250],
    haloAlpha: 0.5,
    haloRadius: 15,
    core: [40, 14, 18],
    coreRadius: 10,
  },
];

/**
 * The signal glow each foe carries, in its own hue.
 *
 * The same reason as the charge ramp: `assets/glitch/` has three frames whose
 * center pixel is the board's own color, so a glitch drawn from the seeded art
 * alone would all but vanish for three quarters of its loop.
 */
export const FOE_GLOW = {
  glitch: {
    halo: [226, 44, 86],
    haloAlpha: 0.72,
    haloRadius: 16,
    core: [170, 26, 54],
    coreRadius: 11,
  },
  dropper: {
    halo: [236, 168, 56],
    haloAlpha: 0.72,
    haloRadius: 16,
    core: [130, 84, 12],
    coreRadius: 11,
  },
  corruptor: {
    halo: [132, 214, 48],
    haloAlpha: 0.72,
    haloRadius: 16,
    core: [40, 108, 24],
    coreRadius: 11,
  },
} as const satisfies Record<string, Glow>;

/** The cursor's own glow, which lifts it off the band it sits in. */
export const CURSOR_GLOW: Glow = {
  halo: [72, 208, 244],
  haloAlpha: 0.4,
  haloRadius: 17,
  core: [24, 78, 96],
  coreRadius: 9,
};

// ---- HUD layout ----------------------------------------------------------

export const HUD_PAD_X = 30;
export const HUD_LABEL_Y = 30;
export const HUD_VALUE_Y = 60;
export const HUD_LABEL_PX = 13;
export const HUD_SCORE_PX = 32;
export const HUD_LEVEL_PX = 26;

/** The most life pips the bar draws before it falls back to the count alone. */
export const HUD_MAX_PIPS = 6;

// ---- Screen copy of this build's own -------------------------------------

/** The hint line under the title menu. */
export const TITLE_HINT = "ARROWS OR WASD TO CHOOSE     ENTER TO CONFIRM";

/** The how-to screen, in a player's words. */
export const HOWTO_TITLE = "HOW TO PLAY";

export const HOWTO_LINES: readonly string[] = [
  "A data-worm winds down the board. Cut every one of its segments",
  "with your bolts before a segment reaches the band you fly in.",
  "",
  "Every node the worm is turned by gains charge, so the collision",
  "that steers the worm also arms the board it steers on. Shoot a",
  "fully charged node and it detonates, arcing through the charged",
  "cluster around it, clearing those nodes and frying every worm",
  "segment caught in the blast.",
  "",
  "A critical node the worm reaches sends it diving straight down.",
  "Every segment you cut leaves a fresh node behind, so the field",
  "thickens as the fight goes on.",
  "",
  "Three foes work the board with you. The glitch skitters about",
  "and eats nodes. The dropper falls down a column and reseeds it,",
  "and takes two bolts. The corruptor crawls the upper rows and",
  "slams the nodes it crosses straight to critical.",
  "",
  "MOVE with the ARROWS or WASD. FIRE with SPACE.",
  "PAUSE with P or ESC. MUTE with M.",
];

export const HOWTO_HINT = "ESC TO GO BACK";
