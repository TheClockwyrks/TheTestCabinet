// Wireworm — the look this build chose.
//
// The specification fixes NO palette and NO typeface: `specs/overview.md` states
// what a player has to read at a glance — the charge ramp, the worm against the
// field, the cursor against the band, the three foes apart from one another —
// and leaves every color and every letterform to the build. This module is that
// choice, gathered in one place so the picture is designed rather than
// scattered.
//
// The board is a dead circuit board seen in the dark: a near-black substrate,
// traces in cold slate, and everything the player cares about lit. The seeded
// art already carries its own hues (`specs/assets.md`) — nodes in teal, the worm
// in magenta, the cursor in cyan, and the three foes in red, amber and olive —
// so nothing here recolors a sprite. What it adds is the ground they sit on and
// the light around them: a charge glow that makes the four node states read as a
// ramp at a glance even before the sprite is looked at, a floor band that reads
// across the full width, and text that stands off the substrate.

/**
 * The order the picture is stacked in. Every render component takes its layer
 * from here rather than from a literal, so the overlaps are stated once.
 */
export const LAYER = {
  ground: 0,
  nodes: 10,
  worms: 20,
  foes: 30,
  bolts: 40,
  cursor: 50,
  arcs: 60,
  ui: 70,
} as const;

/** The palette, in one place. */
export const COLOR = {
  /** The stage background, which is also what the letterbox bars carry. */
  void: "#05070d",
  /** The board substrate, one step up from the void so the board reads as a board. */
  board: "#0a0f18",
  /** The etched trace grid over the substrate. */
  trace: "#121b28",
  /** The HUD bar behind the readouts, and the rule under it. */
  hudBar: "#070b12",
  hudRule: "#1d4f63",
  /** The player band along the floor, and the lit lip along its top edge. */
  band: "#132234",
  bandEdge: "#39d7ff",
  /** Text, in three weights of attention. */
  text: "#e8f6ff",
  textDim: "#7f97ac",
  accent: "#39d7ff",
  warn: "#ff5f7a",
  gold: "#ffd166",
  /** A bolt in flight, drawn in code. */
  bolt: "#9ff6ff",
  /** The lightning an arc is drawn as, drawn in code. */
  arc: "#dffbff",
  arcGlow: "#5ad9ff",
  /** The scrim a menu screen lays over the board. */
  scrim: "rgba(4, 7, 13, 0.82)",
  /** The fallback fills, for a host that could not decode the seeded art. */
  nodeFallback: ["#2b3a46", "#356b78", "#3fa89c", "#9ef0e4"],
  wormHead: "#e07bff",
  wormBody: "#9540ae",
  wormTail: "#6b2f80",
  cursorFallback: "#59aabf",
  glitchFallback: "#b53555",
  dropperFallback: "#d0a85e",
  corruptorFallback: "#4f6f1e",
} as const;

/**
 * The glow laid under a node, by charge. Charge 0 carries none, and each state
 * above it is brighter and wider than the one below, so the ramp
 * `specs/overview.md` asks for reads from the light alone.
 */
export const CHARGE_GLOW: readonly {
  color: string;
  radius: number;
  alpha: number;
}[] = [
  { color: "#2b3a46", radius: 0, alpha: 0 },
  { color: "#3fb8d8", radius: 15, alpha: 0.28 },
  { color: "#57e8d8", radius: 19, alpha: 0.46 },
  { color: "#d8fff4", radius: 24, alpha: 0.72 },
];

/** The one type family, at the size a line is wanted in. */
export function font(size: number, weight: "bold" | "normal" = "bold"): string {
  return `${weight} ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
}

/** The same, in the monospaced face the readouts' digits are set in. */
export function digits(size: number): string {
  return `bold ${size}px "SFMono-Regular", "Consolas", "Liberation Mono", monospace`;
}

/** A `#rrggbb` color at an alpha, as a CSS color. */
export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
