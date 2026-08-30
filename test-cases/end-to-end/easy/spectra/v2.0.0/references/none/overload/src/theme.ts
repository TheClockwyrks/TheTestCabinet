// Spectra — the look: the palette, the type, and nothing else.
//
// `specs/overview.md` leaves every colour and every typeface to the build and
// fixes one relationship over them: ONE PALETTE FOR BOTH BANDS. The band colours
// below are read off the seeded art — `assets/shard.png` is drawn in
// {@link BAND_COLOR.magenta} and `assets/fighter.png`'s core in
// {@link BAND_COLOR.cyan} — so a code-drawn bullet, the polarity indicator and a
// band-carrying effect all land on exactly the colour the sprites carry, and a
// drone and a bullet of one band read as the same band.
//
// The other rule the palette answers to is BAND BY MORE THAN COLOUR: cyan carries
// the ring accent and magenta the diamond, drawn in code over whatever the band
// appears on, so the two stay legible to a colourblind player.

import type { Band } from "./types";

/** The two band colours, taken from the seeded art. */
export const BAND_COLOR: Readonly<Record<Band, string>> = {
  cyan: "#34e2ff",
  magenta: "#ff4ec7",
};

/** A dimmer wash of each band, for a glow or a fill behind the band's own mark. */
export const BAND_GLOW: Readonly<Record<Band, string>> = {
  cyan: "rgba(52, 226, 255, 0.30)",
  magenta: "rgba(255, 78, 199, 0.30)",
};

/** Every colour the game draws with that is not a band. */
export const COLOR = {
  /** The stage's background, which the letterbox bars carry too. */
  bg: "#05060d",
  /** The play field behind the starfield. */
  field: "#080b16",
  /** The two HUD strips. */
  hud: "#0d1120",
  /** The hairline between a HUD strip and the play field. */
  hudEdge: "#1b2540",
  /** Primary text. */
  text: "#e9f2ff",
  /** Secondary text and a menu item that is not highlighted. */
  textDim: "#7d8cad",
  /** The starfield's marks, drawn at varying alpha over the field. */
  star: "#4a5f8a",
  /** The empty part of the resonance meter. */
  meterEmpty: "#151c30",
  /** The meter's fill below full. */
  meterFill: "#4fd8c0",
  /** The meter's fill once a discharge is ready. */
  meterReady: "#fff2a8",
  /** The charge telegraph and the ship's hull accent. */
  charge: "#ffd86b",
  /** The discharge wave. */
  discharge: "#dff8ff",
  /** The field-wide mark a spectral inversion carries. */
  inversion: "rgba(180, 110, 255, 0.16)",
  /** The inversion mark's border. */
  inversionEdge: "rgba(214, 160, 255, 0.85)",
  /** A screen's dimming veil, over the field. */
  veil: "rgba(4, 5, 12, 0.78)",
} as const;

/** The type stack every readout and every screen is set in. */
export const FONT = {
  /** Headings, the title, and a banner. */
  display: '700 {px}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  /** Body copy and menu items. */
  body: '600 {px}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  /** Digits, so a changing score does not jitter. */
  numeric: '700 {px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** One of {@link FONT}'s stacks at `px` pixels. */
export function font(stack: string, px: number): string {
  return stack.replace("{px}", String(Math.round(px)));
}
