// Coil — the palette and the type.
//
// The specification fixes no palette and no font: it fixes what a player has to
// read at a glance, and the look that answers that is the build's. This is that
// look, in one place, so the board, the HUD, the panels and the overlay stay one
// design. A dark field carries bright, saturated pieces; the head is the brightest
// thing on the board and the pellet the only warm one.

export const COLORS = {
  /** The stage, and the letterbox bars around it. */
  stage: "#0b0e14",
  /** The interior of the board. */
  field: "#0f1420",
  /** The faint per-cell ruling over the interior. */
  rule: "#161c28",
  /** The one-cell wall border. */
  wall: "#2a3550",
  /** An obstacle cell the mode lays. */
  obstacle: "#ffb454",
  /** The snake, where the renderer draws it rather than a sprite. */
  head: "#5ef38c",
  body: "#2fd07a",
  /** The pellet. */
  pellet: "#ff5c8a",
  /** The combo readout and its bar. */
  combo: "#ffd23f",
  /** Text, from the brightest to the faintest. */
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
  /** Panels laid over the board. */
  panel: "rgba(15,20,32,0.92)",
  panelEdge: "rgba(42,53,80,0.7)",
} as const;

/** One monospace stack, so nothing is downloaded and the HUD never reflows. */
export const FONT =
  'ui-monospace, "DejaVu Sans Mono", "SFMono-Regular", Consolas, "Courier New", monospace';
