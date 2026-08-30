// Spectra — the look.
//
// `src/constants.ts` carries every figure the specification fixes and, by
// design, not one colour or type face: `specs/overview.md` states what a player
// must be able to READ at a glance — the two bands apart from each other and
// from the field, a Flux's shimmer, a Prism's layers, a bullet's band — and
// leaves every value behind those readings to the build. This file is this
// build's answer, kept apart from the case-fixed figures so the two are never
// confused for one another.
//
// THE TWO BAND COLOURS ARE NOT THIS BUILD'S INVENTION. `specs/overview.md`'s
// legibility table has one hard relationship in it — "the band colours are the
// two the seeded art carries" — so a code-drawn bullet and a sprite-drawn drone
// read as the same band. `CYAN` and `MAGENTA` below are the exact pixels
// `assets/shard.png`, `assets/flux.png`, `assets/prism.png` and
// `assets/fighter.png` are painted in, and everything this build draws in code
// that carries a band is drawn in one of them.

/** The cyan band, exactly as the seeded art paints it. */
export const CYAN = "#34e2ff";

/** The magenta band, exactly as the seeded art paints it. */
export const MAGENTA = "#ff4ec7";

/** The palette this build draws with. */
export const COLOR = {
  /** The stage background, which the engine clears the canvas to each frame. */
  background: "#05070f",
  /** The play field, a touch lighter than the letterbox around the stage. */
  field: "#080b18",
  /** Both HUD strips. */
  hud: "#0b0f1e",
  /** The hairline between a strip and the field. */
  hudEdge: "#1b2440",
  /** Ordinary text. */
  text: "#dfe6f5",
  /** Text that is present but not the point. */
  textDim: "#7c88a8",
  /** A highlighted menu item. */
  textHot: "#ffffff",
  /** The starfield's marks, well below either band in brightness. */
  star: "#2a3352",
  starBright: "#3c4670",
  /** The ship's hull, matching the seeded fighter's own plating. */
  hull: "#eaf0fb",
  /** The resonance meter's empty trough. */
  meter: "#16203a",
  /** The resonance meter, full and ready to spend. */
  meterReady: "#ffd86b",
} as const;

/** The type stack every readout and every screen is set in. */
export const FONT = {
  /** The title, and nothing else. */
  title: "700 76px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  /** A screen's headings and the score. */
  heading: "700 34px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  /** A menu item, a banner, a HUD readout. */
  body: "600 24px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  /** The how-to-play copy. */
  small: "500 19px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
} as const;
