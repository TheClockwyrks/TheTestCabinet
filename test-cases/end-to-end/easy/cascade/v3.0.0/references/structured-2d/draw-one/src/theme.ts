// Cascade — this build's own look.
//
// The specification deliberately fixes no palette, no typeface and no card
// corner radius (specs/overview.md, Visual design): what it fixes is what a
// player must be able to READ at a glance, and everything else about the look
// is this build's. So every color, every font and every layer number lives
// here, apart from the case-fixed figures in `src/constants.ts`.
//
// The look is a bright billiard-green felt with cream card faces, a deep blue
// card back carrying a gold emblem, and a dark strip along the bottom for the
// HUD. Every pair the legibility table names is separated by a wide margin in
// RGB distance, and the margins are asserted in `theme.test.ts` so a later
// change to the palette cannot quietly break one of them.

/** The palette. Every entry is a 6-digit hex color. */
export const COLOR = {
  /** The felt, and the letterbox bars around the stage. */
  felt: "#1f7a4d",
  /** An empty pile's card-sized mark, and other quiet furniture. */
  slot: "#0f5230",
  slotEdge: "#4ea87a",

  /** A face-up card's body and its outline. */
  cardFace: "#f7f3e7",
  cardEdge: "#2a2f2c",

  /** The two suit colors: hearts and diamonds against spades and clubs. */
  suitRed: "#c62828",
  suitBlack: "#141418",

  /** A face-down card: its body, its lattice and the emblem at its middle. */
  cardBack: "#22439c",
  cardBackLattice: "#3d63c8",
  cardBackEmblem: "#e6be5a",

  /** The highlight around the pile a held run would land on. */
  highlight: "#ffd54a",

  /** The HUD strip, the screen scrim, and the type drawn on both. */
  hud: "#0c2a1b",
  hudEdge: "#2f6b4a",
  panel: "#0a1f14",
  text: "#f4f1e6",
  dim: "#9fc2ad",
} as const;

/**
 * The layer each piece of the picture draws on. The engine's pipeline sorts by
 * layer ascending, so this table IS the overlap order: the painted trail lies
 * over the felt and under the cards still on the foundations, the run in hand
 * lies over the piles it passes, the cards in flight lie over both, and the
 * HUD and the screens lie over everything (specs/victory.md, The painted
 * layer).
 */
export const LAYER = {
  felt: 0,
  trail: 10,
  piles: 20,
  drag: 30,
  highlight: 35,
  flyers: 40,
  hud: 50,
  screens: 60,
} as const;

const FONT_FAMILY =
  '"Trebuchet MS", "Segoe UI", "Helvetica Neue", system-ui, sans-serif';

/** A canvas font string at a size and weight, in this build's one face. */
export function font(size: number, weight = 700): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/** A hex color with an alpha, as an 8-digit hex string. */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const byte = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${byte}`;
}

/** The `[r, g, b]` of a 6-digit hex color, for tests that read pixels. */
export function rgbOf(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** The RGB distance between two colors, out of the 441 the cube spans. */
export function rgbDistance(a: string, b: string): number {
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}
