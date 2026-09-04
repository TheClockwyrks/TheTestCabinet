// Cascade — the look.
//
// `src/constants.ts` deliberately holds no colour and no font: `specs/overview.md`
// fixes what a player must be able to READ at a glance and leaves everything else
// about the look to this build. This module is that decision, gathered in one
// place so the whole table is re-themed by editing one file.
//
// The palette is chosen against the legibility table in `specs/overview.md`, and
// every pair it names clears its contrast by a wide margin. The felt is a bright
// billiard green rather than a dark one for exactly that reason: a dark felt sits
// too close to the black suits, and the pip on a card's face has to read apart
// from the table behind it as surely as the card's paper does.

/** A colour, as the CSS string a canvas takes. */
export const COLOR = {
  /** The table itself, and the letterbox bars around it. */
  felt: "#177a4a",
  /** A quieter felt, for the band a screen's copy sits on. */
  feltShade: "#12633c",

  /** The card-sized mark an empty pile draws at its anchor. */
  slot: "#0c4a2d",
  /** The outline around that mark. */
  slotLine: "#2ea36b",

  /** The paper of a face-up card. */
  cardFace: "#f7f4ea",
  /** The line around every card, face-up or face-down. */
  cardEdge: "#0b2016",
  /** The back of a face-down card. */
  cardBack: "#1d3a8a",
  /** The lattice drawn over that back. */
  cardBackPattern: "#3f63c8",

  /** Hearts and diamonds. */
  suitRed: "#c02942",
  /** Spades and clubs. */
  suitBlack: "#1a1a22",

  /** Copy, on felt and on a panel alike. */
  text: "#f4f1e6",
  /** Secondary copy. */
  textDim: "#bfe3cd",

  /** The mark on a pile a held run would land on. */
  highlight: "#f2c14e",

  /** The strip along the bottom of the table. */
  hudBar: "#0c3a26",
  /** The plate behind a control's label. */
  hudKey: "#1a6b45",
  /** The plate behind a menu item. */
  panel: "#0c3a26",
  /** The line around a plate. */
  panelLine: "#3ea877",

  /** The shadow a lifted run casts over the piles it passes. */
  shadow: "rgba(0, 0, 0, 0.28)",
} as const;

/** The family every string is drawn in. */
export const FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** A font string at `size` logical units, optionally bold. */
export function font(
  size: number,
  weight: "normal" | "bold" = "normal",
): string {
  return `${weight} ${String(size)}px ${FONT_FAMILY}`;
}
