// Cascade — this build's look: the palette, the type, and the copy the
// specification leaves open.
//
// None of this is fixed by the specification. specs/overview.md states what a
// player must be able to READ at a glance — a rank and a suit on a face-up card,
// red suits apart from black, a back apart from a face and from the table, an
// empty slot apart from bare felt, a held run above the piles, a highlighted
// target apart from an unhighlighted one, and legible text — and leaves the
// palette, the type, and every other aspect of the look to the build. So every
// figure here is this build's own choice and lives apart from the case-fixed
// figures in `src/constants.ts`.

/** Green felt, ivory cards, a blue back. */
export const COLOR = {
  /** The felt the whole table sits on, and the color the frame is cleared to. */
  felt: "#147a52",
  /** An empty pile's mark, and the outline that squares it off. */
  slot: "#0a4630",
  slotEdge: "#4fbf8b",
  /** A face-up card. */
  face: "#f7f4ec",
  faceEdge: "#c9c4b4",
  /** The two suit colors. */
  red: "#c41a2a",
  black: "#1a1c22",
  /** A face-down card. */
  back: "#385cbe",
  backPattern: "#2a4694",
  backEdge: "#1e3e96",
  /** A legal drop target under a held run. */
  highlight: "#ffd166",
  highlightWash: "rgba(255, 209, 102, 0.35)",
  /** The shadow a held run casts over the piles it passes. */
  lift: "rgba(0, 0, 0, 0.35)",
  /** The HUD strip and the panels of the controls that sit in it. */
  hud: "#05301f",
  panel: "#0c4a33",
  panelMuted: "#3a2a12",
  /** Type. */
  text: "#f5f2e9",
  textDim: "#bcd8c8",
} as const;

/**
 * A system sans stack: no downloaded web font, so the game draws identically
 * offline and fetches nothing at runtime. DejaVu leads it because it carries the
 * four suit symbols on every platform this runs on.
 */
export const SANS =
  '"DejaVu Sans", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ---- Copy the specification leaves to the build --------------------------

/** The how-to screen's prose (specs/screens.md fixes the tokens it carries). */
export const HOWTO_LINES: readonly string[] = [
  "Build all four foundations from the ACE up to the KING,",
  "one suit on each, and you have won.",
  "",
  "A column builds downward in rank and alternates in color,",
  "and only a KING may fill a column you have emptied.",
  "",
  "Turn the STOCK to bring fresh cards to the waste, and turn",
  "it again once it is spent to run the same cards past you.",
  "",
  "Drag a card, or a run of cards, onto the pile you want it",
  "on. DOUBLE-CLICK a card to send it straight home.",
];

/** The line drawn under the title, above the two menu items. */
export const TITLE_HINT = "Drag with the mouse or a finger.";
