// Floe — this build's own look.
//
// `specs/overview.md` fixes no palette and no typeface. What it fixes is what a
// player has to be able to READ AT A GLANCE: the five bands told apart, deep
// water told from a floe on the same row, an open bay told from the shore beside
// it, the critter and the bear told from whatever they stand on, and every piece
// of text legible against its own background. Everything in this file is this
// build's answer to that table, which is why it lives here rather than beside the
// case-fixed figures in `src/constants.ts`.
//
// The look is a polar strait at blue hour: the far shore is the brightest ice on
// the stage, the near shore a colder blue ice, the median shelf an older
// green-grey pressure ridge, the ice band a darker packed lane, and the water a
// deep navy that reads as somewhere a player must not stand. The five tints step
// down in lightness in that order, so the two safe strips sit lighter than the
// two crossing zones on either side of them and the bands are separable at a
// glance and by measurement alike.
//
// The seeded art is drawn over those bands unchanged: the critter is warm amber
// against every band it can stand on, the bear near-white against the two shores
// and the shelf, and the submerged bear's own silhouette pale against the navy.

/** The stage background, and the letterbox bars around it. */
export const BACKGROUND = "#060e18";

/** Every colour this build draws. */
export const COLOR = {
  /** The stage ground, behind everything. */
  background: BACKGROUND,

  // ---- The five bands (specs/strait.md, specs/overview.md) ---------------

  /** Rows 0 and 1: the far shore, the brightest ice on the stage. */
  farShore: "#e2ecf5",
  /** Row 19: the near shore, a colder blue ice. */
  nearShore: "#7098c0",
  /** Row 10: the median shelf, an older green-grey ridge. */
  median: "#789676",
  /** Rows 11 to 18: the ice band, darker packed lanes. */
  iceBand: "#38546c",
  /** Rows 2 to 9: deep water. */
  water: "#0c284c",

  /** The hairlines the bands are separated by. */
  bandEdge: "#0b1a2a",
  /** The lane ruling inside the two crossing bands. */
  laneRule: "#2b4256",
  /** The crests drawn across the water. */
  waterCrest: "#1b3c66",

  // ---- The bays (specs/bays.md) ------------------------------------------

  /** An open bay: an opening in the shore, the water showing through it. */
  bayOpen: "#0c284c",
  /** An open bay's lip, so the opening reads as cut into the shore. */
  bayLip: "#9fb8cc",
  /** A filled bay: warm, occupied, and plainly not an opening. */
  bayFilled: "#d6944a",

  // ---- The HUD and the screens (specs/ui.md) -----------------------------

  /** The HUD bar, and the panel every screen's text stands on. */
  panel: "#101a26",
  /** The panel's edge. */
  panelEdge: "#2c4056",
  /** Every readout and every line of body text. */
  text: "#eef4fa",
  /** A label beside a readout, and a secondary line. */
  textDim: "#a8bece",
  /** The highlighted menu item, and any figure the eye should go to. */
  accent: "#ffd060",
  /** A menu item that is not highlighted. */
  menuIdle: "#a8bece",
  /** The scrim a screen's panel is laid over. */
  scrim: "rgba(6, 14, 24, 0.78)",
  /** The lighter scrim the pause menu is laid over, so the strait shows through. */
  scrimPause: "rgba(6, 14, 24, 0.62)",

  // ---- Marks drawn in code (specs/assets.md) ------------------------------

  /** The bonus catch. */
  fish: "#ffb347",
  /** The bonus catch's fin and eye. */
  fishDark: "#7a3d0c",
  /** A splash, where the critter falls in. */
  splash: "#dcecf8",
} as const;

/** The type stack, and the sizes the HUD and the screens are set at. */
export const FONT = {
  /** One stack, so every figure and every label sits on the same metrics. */
  family: '"DejaVu Sans Mono", "SFMono-Regular", Menlo, Consolas, monospace',
  hudLabel: 13,
  hudValue: 24,
  title: 86,
  tagline: 22,
  heading: 34,
  body: 19,
  menu: 26,
} as const;

/** The CSS `font` string for a size in the stack above. */
export function font(size: number, weight = 700): string {
  return `${weight} ${size}px ${FONT.family}`;
}

/** How many times a second a two-frame pair alternates. The rate is the build's. */
export const ANIM_FPS = 7;
