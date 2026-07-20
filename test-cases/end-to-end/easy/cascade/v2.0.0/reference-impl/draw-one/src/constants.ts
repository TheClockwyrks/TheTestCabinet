// Cascade — canonical constants.
//
// Every value here is in the fixed 1280x720 logical-pixel coordinate space
// defined by the specification (origin top-left, x right, y down). Rendering
// scales this space uniformly to the window; game logic never leaves it.

export const FIELD_W = 1280;
export const FIELD_H = 720;

// ---- Palette (matches specs/overview.md) -------------------------------
export const COLOR = {
  felt: "#1a7a4a", // table felt
  feltShade: "#12603a", // edge vignette
  slot: "#0e5233", // empty pile slot outline
  cardFace: "#f7f4ec", // card face
  cardBorder: "#cfc9b8", // card face border
  red: "#c62828", // hearts, diamonds
  black: "#1b2733", // spades, clubs
  backField: "#2a5db0", // card back field
  backBorder: "#1f478c", // card back border
  backMotif: "#9ec1f5", // card back motif
  highlight: "#ffd54a", // drop-target highlight / menu accent
  text: "#f4f9f5", // primary text on felt
  textDim: "#bfe0cd", // secondary / dim text
  overlay: "rgba(6, 40, 24, 0.62)", // dim table behind the menu
  banner: "rgba(6, 40, 24, 0.82)", // win banner backdrop
} as const;

// A system sans-serif stack: no downloaded web font, so the game renders
// identically offline. The stack also supplies the Unicode suit pips.
export const UI_FONT =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// ---- Card geometry -----------------------------------------------------
export const CARD_W = 100;
export const CARD_H = 140;
export const CARD_RADIUS = 8;

// ---- Table layout (specs/layout.md) ------------------------------------
// The seven tableau columns, evenly spaced with a pitch of 122, centered.
export const COLS_X = [224, 346, 468, 590, 712, 834, 956] as const;

export const TOP_Y = 24; // top row (stock / waste / foundations)
export const TABLEAU_Y = 180; // top of the tableau columns

export const STOCK_X = COLS_X[0]; // 224
export const WASTE_X = COLS_X[1]; // 346
export const FOUNDATION_X = [COLS_X[3], COLS_X[4], COLS_X[5], COLS_X[6]] as const; // 590, 712, 834, 956

// Vertical overlap in a tableau column, by the face of the card above.
export const FACE_DOWN_OFFSET = 24; // when the card above is face-down
export const FACE_UP_OFFSET = 34; // when the card above is face-up (natural)
export const FACE_UP_OFFSET_MIN = 14; // compression floor for long columns
export const COLUMN_BOTTOM_LIMIT = 676; // a column's lowest card edge may not pass this

// Draw One shows a single top waste card; prior cards are squared beneath it, so
// no fan pitch is applied (WASTE_FAN is kept only for the shared layout signature).
export const WASTE_FAN = 26;
export const WASTE_FAN_MAX = 1; // Draw One shows only the single top waste card
export const TURN_COUNT = 1; // Draw One: the stock turns one at a time

// This build's deal-mode id, reported by the debug snapshot (specs/deal-mode.md).
export const DEAL_MODE = "draw-one";

// ---- Victory cascade (specs/cascade.md) --------------------------------
export const FIXED_STEP = 1 / 120; // simulation timestep (Hz), decoupled from render
export const LAUNCH_INTERVAL = 0.18; // one card launches every 0.18 s
export const GRAVITY = 1800; // px/s^2, downward
export const BOUNCE_DAMP = 0.8; // vertical velocity retained per floor bounce
export const LAUNCH_VY = -120; // initial upward pop, px/s
export const LAUNCH_VX_MIN = 180; // minimum horizontal launch speed magnitude
export const LAUNCH_VX_MAX = 420; // maximum horizontal launch speed magnitude
export const FLOOR_Y = FIELD_H - CARD_H; // seated y when a card rests on the floor (580)

// ---- Interaction -------------------------------------------------------
export const DRAG_THRESHOLD = 5; // px of motion before a press becomes a drag
