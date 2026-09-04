// Shatter — the look: the palette, the layer table, and the type stack.
//
// Nothing here is fixed by the specification: `specs/overview.md` leaves the
// palette, the typography and every other aspect of the appearance to the
// build, and holds it only to the legibility table it states. This module is
// where those choices are made once, so no colour and no font string is written
// anywhere else.

/** The palette. Every colour the game draws comes from here. */
export const COLOR = {
  /** Deep space: the field's background, and the letterbox around it. */
  space: "#05070f",
  /** The star's core, and the brightest point on the field. */
  starCore: "#fff3c4",
  /** The halo the core fades outward into. */
  starHalo: "#ffb347",
  /** The ship. */
  ship: "#7ff2ff",
  /** The ship's outline, so the hull reads against a bright halo. */
  shipEdge: "#dffbff",
  /** The flame at the ship's tail while thrust is applied. */
  flame: "#ff9b4a",
  /** A rock at full health. */
  rockWhole: "#9aa8c7",
  /** A rock one hit from coming apart. */
  rockBroken: "#7a4a3e",
  /** The bright flash a chipping hit leaves on a rock. */
  rockFlash: "#fdf6ea",
  /** The saucer's hull. */
  saucer: "#ff5fa2",
  /** The saucer's dome. */
  saucerDome: "#ffd0e4",
  /** One of the ship's bullets. */
  bullet: "#ffe57a",
  /** One of the saucer's bullets. */
  enemyBullet: "#ff7b5a",
  /** The torpedo's body. */
  torpedo: "#8affc1",
  /** The torpedo's exhaust. */
  torpedoFlame: "#e6fff2",
  /** Every readout and every screen's copy. */
  text: "#e8f0ff",
  /** Copy that is present but not the point of the screen. */
  textDim: "#7f8cad",
  /** The highlighted entry of a menu. */
  accent: "#ffd166",
  /** The scrim drawn over the frozen field behind the pause menu. */
  scrim: "rgba(4, 6, 14, 0.86)",
} as const;

/**
 * The pipeline's layer table. The engine sorts every render component by
 * `layer` ascending, so the order the picture overlaps in is stated here rather
 * than by the order the draw calls are written in.
 */
export const LAYER = {
  star: 0,
  rocks: 10,
  bullets: 20,
  torpedoes: 30,
  ship: 40,
  saucer: 50,
  hud: 60,
  screens: 70,
} as const;

/** The type stack. Sizes are world units, like every other drawn quantity. */
export const FONT = {
  title: "700 92px 'Trebuchet MS', 'Segoe UI', sans-serif",
  heading: "700 52px 'Trebuchet MS', 'Segoe UI', sans-serif",
  banner: "700 64px 'Trebuchet MS', 'Segoe UI', sans-serif",
  menu: "600 34px 'Trebuchet MS', 'Segoe UI', sans-serif",
  body: "400 26px 'Trebuchet MS', 'Segoe UI', sans-serif",
  score: "700 40px 'Trebuchet MS', 'Segoe UI', sans-serif",
  label: "600 20px 'Trebuchet MS', 'Segoe UI', sans-serif",
} as const;
