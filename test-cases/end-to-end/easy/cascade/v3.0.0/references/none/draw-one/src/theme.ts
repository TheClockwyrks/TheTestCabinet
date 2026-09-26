// Cascade — the look.
//
// Every value here is this build's CHOICE. The specification fixes no palette
// and no typeface (`specs/overview.md`); what it fixes is what a player must be
// able to read at a glance, and the values below are picked to clear those
// margins with room to spare:
//
//   * a card of either face reads apart from the felt it sits on;
//   * a face-down card reads apart from a face-up one;
//   * the two suit colours are told apart at a glance;
//   * an empty slot reads apart from the bare table;
//   * every string reads against what sits behind it.
//
// The felt is flat rather than shaded, deliberately: a card, a slot and a
// string are each read against "the table", and a table whose colour drifts
// across the stage would make that a different question in each corner.

/** Every colour the build draws with. */
export const COLOR = {
  /** The table, and the letterbox bars the runtime clears to. */
  felt: "#1a7a4a",
  /** An empty pile's mark, which reads apart from the bare felt. */
  slot: "#0a3d26",
  slotEdge: "#3fa878",
  cardFace: "#f7f4ec",
  cardEdge: "#b9b2a0",
  red: "#c62828",
  black: "#141c26",
  /** A card back: one flat field and a lattice over it. */
  backField: "#24509c",
  backMotif: "#8fb4ee",
  backEdge: "#16326a",
  /** A legal drop target under a held run. */
  highlight: "#ffd54a",
  highlightWash: "rgba(255, 213, 74, 0.32)",
  /** Text on the felt, and the panels text sits on. */
  text: "#f6fbf7",
  textDim: "#cdeadb",
  panel: "#083a24",
  panelEdge: "#2f8f63",
  screenWash: "#0a3a24",
} as const;

/**
 * A system sans-serif stack: no font is downloaded, so the game draws the same
 * offline, and the stack carries the Unicode suit pips.
 */
export const UI_FONT =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** The rank as it is drawn on a card, indexed by rank. */
export const RANK_LABEL: readonly string[] = [
  "",
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/** The pip each suit is drawn with. */
export const SUIT_GLYPH: Readonly<Record<string, string>> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};
