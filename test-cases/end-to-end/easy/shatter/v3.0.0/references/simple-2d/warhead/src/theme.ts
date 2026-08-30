// Shatter — the palette and the type stack.
//
// The specification fixes nothing about the look beyond one requirement and a
// table of things a player must be able to read at a glance
// (`specs/overview.md`): the field is dark, and the ship, the star, a rock, the
// saucer, a shot, the thrust flame, the respawn grace, a rock's damage, the
// torpedo, the HUD and every screen's text each read apart from what is behind
// them. The colours below are this build's answer to that table and nothing
// else is authoritative about them.
//
// Two of them carry a requirement rather than a preference:
//
//   * BACKGROUND is deep enough that its luminance sits far below a quarter of
//     full, which `specs/overview.md` states as a rule of the field.
//   * Every body's colour is far from BACKGROUND and far from the bodies it must
//     be told apart from — the rocks from the ship and the bullets, the saucer
//     from the rocks, the torpedo from the bullets.

/** The field's own colour, and the colour the engine clears the canvas to. */
export const BACKGROUND = "#05070f";

/** The faint stars scattered behind the field. Decoration alone. */
export const STARFIELD = "#1d2438";

export const COLOR = {
  /** The star's solid core, and the halo that fades outward from it. */
  starCore: "#fff4d0",
  starInner: "#ffd166",
  starHalo: "#ff8a3c",

  /** The ship, its outline, and the flame at its tail. */
  ship: "#7fe3ff",
  shipEdge: "#e8fbff",
  flameHot: "#fff0c2",
  flameCold: "#ff9b4a",

  /** A rock at full health, and one down to its last hit. */
  rockWhole: "#8a8f9e",
  rockRuined: "#6e4a44",
  rockEdge: "#cfd6e4",
  rockFlash: "#fff6e2",

  /** The saucer: a craft, never debris. */
  saucer: "#b98cff",
  saucerDome: "#e6d6ff",
  saucerEdge: "#f2ebff",

  /** The ship's rounds, and the saucer's. */
  bullet: "#ffe27a",
  bulletTrail: "#ffb347",
  enemyBullet: "#ff5f8f",

  /** The heavy weapon, told apart from a round at a glance. */
  torpedo: "#ff5c3a",
  torpedoEdge: "#ffd2c2",
  torpedoFlame: "#ffe08a",

  /** Text, the HUD, and the menus. */
  text: "#e9f2ff",
  textDim: "#8895b0",
  highlight: "#ffd166",
  scrim: "rgba(4, 6, 14, 0.74)",
} as const;

/** The type stack every screen and readout is drawn in. */
export const FONT = "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif";

/** A font string at `size` logical units, optionally bold. */
export function font(size: number, weight = "600"): string {
  return `${weight} ${String(size)}px ${FONT}`;
}
