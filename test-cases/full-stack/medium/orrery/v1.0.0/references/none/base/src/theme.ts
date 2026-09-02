// Orrery — the palette and the type (specs/ui.md "Presentation").
//
// Orrery fixes no palette, no font, and no background; what it fixes is
// legibility. This build's sky is a cold blue-black, its brass a warm gold,
// and its type a plain sans stack, chosen once here and held across every
// screen, panel, and glyph so the game reads as one place.

/** Every color the build draws in code. */
export const COLORS = {
  /** The sky, and the letterbox bars around the stage. */
  sky: "#080b16",
  /** The field's cells. */
  hex: "#141b30",
  /** A hex's edge. */
  hexEdge: "#243154",
  /** A panel's ground. */
  panel: "#0d1223",
  /** A panel's edge. */
  panelEdge: "#2b3a63",
  /** Ordinary text. */
  text: "#dfe6f7",
  /** Text that sits back. */
  textDim: "#93a1c4",
  /** Text that sits further back still. */
  textFaint: "#5f6d92",
  /** Brass: the machine's own color, and the highlight. */
  brass: "#e8b661",
  /** A refusal, a fault, and anything illegal. */
  fault: "#e2664f",
} as const;

/** The font stack every piece of drawn text uses. */
export const FONT_STACK =
  '"Iosevka", "SF Mono", "Segoe UI", system-ui, sans-serif';
