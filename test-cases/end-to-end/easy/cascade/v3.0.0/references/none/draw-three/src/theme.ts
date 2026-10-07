// Cascade — this build's own look.
//
// The specification fixes no palette and no typeface: it fixes what a player must
// READ — a legible rank and suit, red told from black, a back told from a face, a
// card told from the table, an empty slot told from bare felt, a held run reading
// as lifted, a highlighted target reading apart from the same pile unhighlighted,
// and legible text (specs/overview.md). Everything below is this build's answer
// to that, and nothing else in the build depends on the particular values.
//
// The choice is a deep felt table under warm ivory cards, with a cobalt back and
// an amber highlight, so every pair in that list is far apart at a glance.

/** The palette, as CSS colors. */
export const COLOR = {
  /** The felt, and the color the letterbox bars carry. */
  table: "#1a6b45",
  /** The vignette drawn into the felt's edges. */
  tableEdge: "#125236",
  /** An empty pile's slot, which reads as a shadow cut into the felt. */
  slotFill: "#0b4b2c",
  slotLine: "#41a173",
  /** A card face. */
  cardFace: "#f7f4ec",
  cardEdge: "#c6c0af",
  /** Hearts and diamonds. */
  red: "#c62828",
  /** Spades and clubs. */
  black: "#1b2733",
  /** A card back. */
  backFill: "#2a5db0",
  backEdge: "#1b3f7e",
  backMotif: "#9ec1f5",
  /** A legal drop target under a held run. */
  highlight: "#ffd54a",
  /** Text on the felt. */
  text: "#f4f9f5",
  textDim: "#bfe0cd",
  /** The HUD strip. */
  hudFill: "#0c4429",
  hudEdge: "#2f8a5f",
  /** A control's plate, and the plate of a title item. */
  plateFill: "#0f5c39",
  plateEdge: "#57b98a",
  /** The panel behind the win message. */
  panel: "rgba(6, 40, 24, 0.84)",
  /** The shadow under a held run and under a card in flight. */
  shadow: "rgba(0, 0, 0, 0.38)",
} as const;

/**
 * A system sans-serif stack.
 *
 * No web font is downloaded, so the game draws the same offline as online and a
 * slow network never leaves a screen wordless.
 */
export const FONT =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A card's drawn corner radius. Styling, which the specs leave to the build. */
export const CARD_RADIUS = 9;
