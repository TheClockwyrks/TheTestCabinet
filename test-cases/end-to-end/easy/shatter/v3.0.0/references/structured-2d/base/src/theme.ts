// Shatter — the look: the palette, the type, and the layer order.
//
// `specs/overview.md` fixes NO colour and NO typeface. What it fixes is a table
// of things a player must read at a glance, so this module is where the build
// answers it: the field reads as deep space, and the ship, the star, a rock,
// the saucer, a bullet and the HUD each stand apart from the field and from one
// another.
//
// The layer table is the only place a draw order is written. The rendering
// pipeline sorts the components it collects by `layer`, so the order the
// picture overlaps in comes from here rather than from the order the draws
// happen to be attached in.

/** Every colour the game draws with. */
export const COLOR = {
  /** Deep space: the field's ground, and the letterbox bars around it. */
  space: "#04060f",
  /** The far stars scattered over the ground. Dim enough to leave it dark. */
  dust: "#1a2136",

  /** The star's core, and the halo's tint. */
  core: "#ffffff",
  coreRim: "#8fd0ff",
  halo: "126, 178, 255",

  rock: "#8a7f6d",
  rockEdge: "#c9bda4",

  ship: "#7fe9ff",
  shipEdge: "#e2fdff",
  /** The ship inside its respawn grace, on the dim half of the blink. */
  shipGrace: "#2f6b7d",
  flame: "#ffb347",

  bullet: "#ffe9a8",

  saucer: "#c46bff",
  saucerDome: "#ffd8ff",
  enemyBullet: "#ff5f6d",

  text: "#e8f4ff",
  textDim: "#8fa3bd",
  highlight: "#7ff0ff",
  banner: "#ffd479",
  /** Laid over the field behind a menu, so its text reads against it. */
  scrim: "rgba(3, 5, 13, 0.78)",
} as const;

/** The type stack, and the sizes the screens are set in. */
export const FONT = {
  title: "700 96px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  tagline: "600 26px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  heading: "700 44px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  menu: "600 32px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  body: "500 22px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  score: "700 40px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  banner: "700 60px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  notice: "700 34px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
} as const;

/** The draw order, lowest first. Gaps leave room for a layer between two. */
export const LAYER = {
  space: 0,
  star: 10,
  rocks: 20,
  bullets: 30,
  ship: 40,
  saucer: 50,
  hud: 60,
  screens: 70,
} as const;
