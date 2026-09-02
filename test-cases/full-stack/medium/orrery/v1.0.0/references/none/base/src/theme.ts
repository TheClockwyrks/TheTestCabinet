// Orrery — the palette and the type (specs/ui.md "Presentation").
//
// Orrery fixes no palette, no font, and no background; what it fixes is
// legibility. This build's sky is a cold blue-black, its brass a warm gold,
// and its type a plain sans stack, chosen once here and held across every
// screen, panel, and glyph so the game reads as one place. The values are the
// ones `scripts/sprites/palette.mjs` paints the produced sprites from, so a
// sprite and the chrome around it belong to one instrument shop.

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
  /** Brass in shadow, for a shaft and an engraved edge. */
  brassDark: "#a97a2f",
  /** Cold worked metal, for a gripper and a set's machinery. */
  steel: "#a8b3cb",
  /** A refusal, a fault, and anything illegal. */
  fault: "#e2664f",
  /** A legal ghost, and everything the editor is willing to commit. */
  legal: "#7fd6a0",
  /** An engraved footprint's ground. */
  engraving: "#1d2138",
  /** The hex the pointer is targeting. */
  target: "#f6dca6",
} as const;

/**
 * A fallback tint for each mote type, matching the body color of its produced
 * sprite. Drawn only when the sprite is unavailable, so a missing file leaves
 * the motes legible rather than invisible (specs/assets.md).
 */
export const MOTE_COLORS: Record<string, string> = {
  dust: "#a49b88",
  nebula: "#8c4fd0",
  comet: "#4ec6f0",
  nova: "#ff7a1e",
  meteor: "#7b7466",
  mercury: "#97a2b6",
  saturn: "#b0894c",
  jupiter: "#d98b3a",
  mars: "#c9503a",
  venus: "#e6c47a",
  luna: "#c2cee4",
  sol: "#ffcf45",
  umbra: "#7d5cba",
  lumen: "#ffe9a8",
  aether: "#e2f8ff",
};

/** The font stack every piece of drawn text uses. */
export const FONT_STACK =
  '"Iosevka", "SF Mono", "Segoe UI", system-ui, sans-serif';
