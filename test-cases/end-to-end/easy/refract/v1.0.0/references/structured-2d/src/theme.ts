// Refract — this build's own look.
//
// The specification deliberately fixes no palette, no font, no node artwork,
// no beam rendering, and no background (specs/overview.md, Visual design), so
// everything aesthetic lives here, apart from the case-fixed figures in
// `src/constants.ts`. The bench is a deep blue-black; the three channels carry
// warm amber, cool cyan, and violet — three hues far apart on the wheel and
// distinct in brightness, so they separate even for a player who reads hue
// poorly, on top of the silhouettes that carry channel identity by form.

import type { Channel } from "./game";

export const COLOR = {
  /** The bench, and the letterbox bars around it. */
  bg: "#0a0d18",
  /** The soft pool of light behind the board. */
  benchGlow: "#131a30",
  /** Empty-cell markers and other quiet furniture. */
  faint: "#2c3352",
  /** Secondary text and de-emphasized items. */
  dim: "#8a93b8",
  /** Primary text. */
  text: "#eaeef9",
  /** The menu highlight and other bright accents. */
  bright: "#ffffff",
  /** Overlay panels over a finished board. */
  panel: "#10142399",
  panelSolid: "#141930",
  panelBorder: "#3a4370",
  /** The full-stage dim under an overlay — light, so the finished board and
   * its beams stay visible behind the solved and complete screens. */
  scrim: "#05070e66",
  /** A crystal's body and its unspent pips. */
  crystal: "#dcecff",
  crystalEdge: "#8fb2d8",
  crystalSpent: "#3c465e",
  /** Select-grid tile states (none carries a channel hue). */
  locked: "#171b2e",
  lockedEdge: "#262c47",
  solvedTile: "#173327",
  solvedEdge: "#4fd18f",
} as const;

/** One hue per channel (specs/overview.md: told apart at a glance). */
export const CHANNEL_COLOR: Readonly<Record<Channel, string>> = {
  triangle: "#ffb454",
  square: "#3fd6e8",
  diamond: "#df7bff",
};

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

const FONT_FAMILY =
  '"Bahnschrift", "Segoe UI", "Helvetica Neue", system-ui, sans-serif';

/** A canvas font string at a size and weight, in this build's one face. */
export function font(size: number, weight = 600): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}
