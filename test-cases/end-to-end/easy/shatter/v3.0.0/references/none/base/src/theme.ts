// Shatter — the look: the palette, the type, and the geometry a body is drawn
// with.
//
// None of this is fixed by the specification. `specs/overview.md` states what a
// player must be able to READ at a glance — the ship apart from the field, the
// star as a well with a core and a fading halo, a rock apart from the ship, the
// saucer as a craft rather than debris, a tail behind every moving bullet, and
// legible text — and leaves the palette, the type and every drawn dimension to
// the build. This file is where those choices live, so `src/render.ts` reads a
// name rather than a literal and the figures the specs DO fix stay in
// `src/constants.ts`.
//
// The choice here: cold instruments on deep space. A cyan ship, warm grey rocks,
// a gold star and a hot pink saucer, all far enough apart in color that no two
// bodies read as the same thing.

/** Every color the game draws with. */
export const COLOR = {
  /** The field, and the letterbox bars around it. Deep space, well under a quarter of full. */
  bg: "#05070e",
  /** A panel behind text that would otherwise sit on something bright. */
  panel: "rgba(4, 6, 14, 0.86)",
  /**
   * A scrim over the frozen field behind the pause and game-over menus.
   *
   * Deliberately light: `specs/ui.md` requires the field to stay VISIBLE behind
   * the pause menu, so the scrim only knocks the field back far enough for the
   * menu to read over it. What makes the menu legible is the plate under it
   * ({@link COLOR.panel}) rather than the scrim.
   */
  scrim: "rgba(4, 6, 14, 0.5)",
  /** The ship's hull. */
  ship: "#6cf0ff",
  /** The ship's hull while its respawn grace runs. */
  shipGrace: "#ffe27a",
  /** The thrust flame's body. */
  thrust: "#ffb347",
  /** The hottest part of the thrust flame. */
  thrustCore: "#fff3d0",
  /** A bullet. */
  bullet: "#f4f8ff",
  /** A rock. */
  rock: "#9aa7bd",
  /** The star's solid core. */
  starCore: "#ffd27a",
  /** The saucer's hull. */
  saucer: "#ff5c8a",
  /** The saucer's canopy. */
  saucerGlass: "#ffd9e4",
  /** A saucer bullet. */
  enemyBullet: "#ff9ab5",
  /** Body text and readouts. */
  text: "#e6edf3",
  /** Text that is present but secondary. */
  textDim: "#93a0b4",
  /** The highlighted entry of a menu, and the score. */
  accent: "#6cf0ff",
} as const;

/**
 * The type stack.
 *
 * A system stack rather than a downloaded face, so the game draws identically
 * offline and needs no network at runtime, which `specs/overview.md` requires of
 * the whole build.
 */
export const FONT =
  '"DejaVu Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

/** The drawn dimensions of the ship, in logical units along and across its facing. */
export const SHIP_ART = {
  /** How far the nose reaches ahead of the centre. */
  nose: 21,
  /** How far the tail reaches behind it, so the hull is 34 long. */
  tail: 13,
  /** Half the width at the tail, so the hull is 26 across there. */
  halfBeam: 13,
  /** How far behind the tail the thrust flame reaches. */
  flame: 20,
} as const;

/** Where the HUD's readouts sit, all clear of the field's centre. */
export const HUD = {
  /** The score's left edge and top. */
  scoreX: 40,
  scoreY: 30,
  scoreSize: 44,
  /** The row of reserve-ship glyphs. */
  livesX: 44,
  livesY: 96,
  /** The gap between two glyphs, wide enough that they read as separate marks. */
  livesGap: 30,
  /** The scale a reserve glyph is drawn at against the flying ship. */
  livesScale: 0.62,
} as const;

/** The type sizes the screens are set in. */
export const TYPE = {
  title: 92,
  tagline: 24,
  menu: 30,
  heading: 34,
  body: 21,
  banner: 60,
  award: 30,
} as const;
