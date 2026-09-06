// Cascade — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down). That space is the
// engine's logical design size: the engine scales and letterboxes it onto the
// canvas, so no value here is ever expressed in real pixels and the game never
// leaves logical space. Every position of a card is its TOP-LEFT corner, which is
// the convention `specs/overview.md` fixes and the one the debug surface reports
// and accepts.
//
// Every rate is PER SECOND and every duration is in SECONDS, because the engine
// hands the game the real elapsed seconds of each frame and imposes no timestep
// of its own. There is deliberately no fixed-step constant: nothing in this game
// counts frames.
//
// What is deliberately NOT here: no color, no font stack, and no card corner
// radius. `specs/overview.md` fixes what a player must be able to READ at a
// glance and leaves every other aspect of the look to this build, so a figure
// that decides nothing about the rules has no place in this file. The one color
// the project carries is `BACKGROUND`, which `src/game.ts` exports.

// ---- Stage and table (specs/table.md) ------------------------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The footprint of every card, face-up or face-down. */
export const CARD_W = 100;
export const CARD_H = 140;

/** The left edge of each of the seven tableau columns, left to right. */
export const COLUMN_X: readonly number[] = [224, 346, 468, 590, 712, 834, 956];

/** The top edge of the stock, the waste and the four foundations. */
export const TOP_ROW_Y = 24;

/** The stock and the waste, side by side at the left of the top row. */
export const STOCK_X = 224;
export const WASTE_X = 346;

/** The left edge of each of the four foundations, left to right. */
export const FOUNDATION_X: readonly number[] = [590, 712, 834, 956];

/** The top edge of every tableau column's first card. */
export const TABLEAU_Y = 180;

/** How far a card sits below the face-down card above it in a column. */
export const FACE_DOWN_OFFSET = 24;

/** How far a card sits below the face-up card above it, uncompressed. */
export const FACE_UP_OFFSET = 34;

/** The smallest face-up offset compression may fall to. */
export const FACE_UP_OFFSET_MIN = 14;

/** The lowest a column's bottom-most card may reach before it compresses. */
export const COLUMN_BOTTOM_LIMIT = 676;

/** The HUD strip along the bottom of the stage. */
export const HUD_Y = 680;
export const HUD_H = 36;

// ---- Controls (specs/controls.md) ----------------------------------------

/** The four menu actions specs/controls.md names, as the engine registers them. */
export const MENU_UP = "menu-up";
export const MENU_DOWN = "menu-down";
export const MENU_CONFIRM = "menu-confirm";
export const MENU_BACK = "menu-back";

/**
 * The `KeyboardEvent.code` values specs/controls.md binds each action to.
 *
 * Codes rather than keys, so the bindings hold on any layout. An action bound to
 * two codes is one action: either raises it.
 */
export const MENU_BINDINGS: Readonly<Record<string, readonly string[]>> = {
  [MENU_UP]: ["ArrowUp", "KeyW"],
  [MENU_DOWN]: ["ArrowDown", "KeyS"],
  [MENU_CONFIRM]: ["Enter", "Space"],
  [MENU_BACK]: ["Escape"],
};

/**
 * How far a release may lie from its press and still be a CLICK rather than a
 * drop, in logical units.
 */
export const DRAG_THRESHOLD = 5;

/** The window and the slop a second press must fall inside to be a double click. */
export const DOUBLE_CLICK_WINDOW = 0.3;
export const DOUBLE_CLICK_SLOP = 20;

// ---- The deck (specs/deal.md) --------------------------------------------

/** The four suits, in the order a deck is built. */
export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;

/** Ace low, King high. */
export const RANK_MIN = 1;
export const RANK_MAX = 13;

export const DECK_SIZE = 52;
export const TABLEAU_COLUMNS = 7;
export const FOUNDATION_COUNT = 4;

/** How a deal divides the deck: 1+2+...+7 to the tableau, the rest to the stock. */
export const DEAL_TABLEAU_CARDS = 28;
export const DEAL_STOCK_CARDS = 24;

// ---- This build's deal mode (specs/stock.md) -----------------------------

/** How many cards one turn of the stock moves onto the waste. */
export const TURN_COUNT = 3;

/** This build's deal-mode id, which the debug surface reports as `dealMode`. */
export const DEAL_MODE = "draw-three";

/** The label drawn on the title screen and in the HUD. */
export const DEAL_MODE_LABEL = "DRAW THREE";

/** How far to the right each further card of the shown set is drawn. */
export const WASTE_FAN = 26;

// ---- The victory cascade (specs/victory.md) ------------------------------

/** Seconds between one card launching and the next. */
export const LAUNCH_INTERVAL = 0.18;

/** The upward pop every launched card leaves with, in units per second. */
export const LAUNCH_VY = -120;

/** The range a launched card's horizontal speed is drawn from. */
export const LAUNCH_VX_MIN = 180;
export const LAUNCH_VX_MAX = 420;

/** Downward acceleration on every card in flight, in units per second squared. */
export const GRAVITY = 1800;

/** The share of vertical speed a floor bounce keeps. */
export const BOUNCE_DAMP = 0.8;

/** The y a bouncing card is seated at: the stage floor, less a card's height. */
export const FLOOR_Y = 580;

// ---- Screen copy (specs/screens.md) --------------------------------------

export const TITLE_TEXT = "CASCADE";
export const TAGLINE_TEXT = "KLONDIKE SOLITAIRE";

/** The two title-screen items, in the order they are drawn. */
export const TITLE_ITEMS = ["NEW GAME", "HOW TO PLAY"] as const;

export const HOWTO_BACK_LABEL = "BACK";

/** The three HUD labels, in the order they are drawn. */
export const HUD_ITEMS = ["NEW GAME", "MENU", "SOUND"] as const;

export const WIN_TEXT = "YOU WIN";

// ---- Audio cues (specs/audio.md) -----------------------------------------

/** The ten cue names, one per event. Define and play exactly these. */
export const CUES = {
  deal: "deal",
  turn: "turn",
  recycle: "recycle",
  lift: "lift",
  drop: "drop",
  reject: "reject",
  flip: "flip",
  home: "home",
  launch: "launch",
  win: "win",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const CASCADE_DEBUG_VERSION = 1;

