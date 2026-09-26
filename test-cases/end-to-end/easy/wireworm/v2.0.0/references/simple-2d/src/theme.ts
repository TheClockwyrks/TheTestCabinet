// Wireworm — this build's own look.
//
// Nothing here is fixed by the specification. `src/constants.ts` carries the
// figures the specification names and deliberately carries no color and no
// typeface; what the board looks like is this build's design, and it lives here
// so the two never get confused for one another.
//
// The choices answer the legibility table in `specs/overview.md`. The board is a
// cold, almost black circuit substrate. The seeded art supplies the hues that
// matter — a node ramps grey-teal to white-mint as it charges, the worm is
// violet, the cursor cyan, the glitch red, the dropper amber, the corruptor
// green — so everything drawn in code here is picked to sit under those without
// competing with them: the substrate and its trace grid are desaturated blues,
// the band is a lighter slab with a lit edge, and the only saturated things
// drawn in code are the cursor's bolt and a discharge arc, both of which are
// meant to read instantly against the field.

/** Every color this build draws in code. */
export const COLOR = {
  /** The stage background, which the letterbox bars carry as well. */
  background: "#05080f",

  /** The board substrate beneath the tiles. */
  board: "#080d17",
  /** The faint trace grid ruled across the board. */
  grid: "#0e1626",
  /** The heavier rule every eight tiles, which gives the board its scale. */
  gridMajor: "#152134",

  /** The player band: a lighter slab, with a lit rail along its top edge. */
  band: "#101b2c",
  bandEdge: "#2f6f8a",

  /** The HUD bar above the board, and the rule that separates the two. */
  hud: "#04070d",
  hudEdge: "#1b3040",

  /** The bolt the cursor fires, and the glow around it. */
  bolt: "#c9f7ff",
  boltGlow: "#3fd0ff",

  /** A discharge arc: a white-hot core inside a mint halo. */
  arcCore: "#f2fffa",
  arcGlow: "#84e6bd",

  /** The ring drawn around the cursor while its spawn-in invulnerability runs. */
  invulnerable: "#7fe3ff",

  /** Text: the ordinary readout, the emphasis, and the quieted line. */
  text: "#dbe8f5",
  textBright: "#ffffff",
  textDim: "#6d8299",
  /** The accent the title, the highlighted menu row, and the banner carry. */
  accent: "#84e6bd",
  /** The wash drawn over the board behind a menu or a banner. */
  scrim: "rgba(3, 6, 12, 0.78)",
  /** The lighter wash the level banner sits on. */
  scrimLight: "rgba(3, 6, 12, 0.55)",
} as const;

/**
 * The type. One family for everything, at a handful of sizes: the art is pixel
 * art on a technical board, and a squared-off face is what sits with it.
 */
export const FONT_FAMILY =
  '"Consolas", "SF Mono", "DejaVu Sans Mono", "Courier New", monospace';

/** A CSS font shorthand at `size` logical units, bold unless told otherwise. */
export function font(size: number, weight: "bold" | "normal" = "bold"): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}
