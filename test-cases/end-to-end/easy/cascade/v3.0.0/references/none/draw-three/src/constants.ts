// Cascade — every figure the specification fixes, named once.
//
// The specs state each of these under a name and the value stated there is
// authoritative, so this file is a transcription rather than a set of choices:
// nothing here is tuned, and nothing the specs leave open lives here. The look —
// the palette, the type, the way a card face is drawn — is this build's own and
// lives in `src/theme.ts`.
//
// Every length is in the fixed logical stage's units (specs/overview.md), every
// rate is per second, and every position is a TOP-LEFT corner.

// ---- The stage (specs/overview.md) --------------------------------------

/** The logical design width the game draws in. */
export const STAGE_W = 1280;
/** The logical design height the game draws in. */
export const STAGE_H = 720;

// ---- A card and the table (specs/table.md) ------------------------------

/** A card's footprint width, wherever it sits. */
export const CARD_W = 100;
/** A card's footprint height, wherever it sits. */
export const CARD_H = 140;

/** The left edge of each of the seven tableau columns, at a pitch of 122. */
export const COLUMN_X = [224, 346, 468, 590, 712, 834, 956] as const;

/** The top edge of the stock, the waste and the four foundations. */
export const TOP_ROW_Y = 24;
/** The stock's left edge. */
export const STOCK_X = 224;
/** The waste's left edge. */
export const WASTE_X = 346;
/** The left edge of each of the four foundations. */
export const FOUNDATION_X = [590, 712, 834, 956] as const;

/** The top edge of every tableau column. */
export const TABLEAU_Y = 180;

/** A column card's offset below a face-down card. */
export const FACE_DOWN_OFFSET = 24;
/** A column card's natural offset below a face-up card. */
export const FACE_UP_OFFSET = 34;
/** The floor the face-up offset is compressed to and no further. */
export const FACE_UP_OFFSET_MIN = 14;
/** A column's lowest card's bottom edge may not pass this line. */
export const COLUMN_BOTTOM_LIMIT = 676;

/** The top edge of the HUD strip. */
export const HUD_Y = 680;
/** The height of the HUD strip. */
export const HUD_H = 36;

// ---- The controls (specs/controls.md) -----------------------------------

/** A control's hit rectangle, in logical units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The title screen's `NEW GAME` item. */
export const TITLE_NEW_GAME: Rect = { x: 480, y: 448, w: 320, h: 52 };
/** The title screen's `HOW TO PLAY` item. */
export const TITLE_HOW_TO: Rect = { x: 480, y: 516, w: 320, h: 52 };
/** The how-to screen's way back. */
export const HOWTO_BACK: Rect = { x: 480, y: 600, w: 320, h: 52 };
/** The HUD's `NEW GAME` control. */
export const HUD_NEW_GAME: Rect = { x: 224, y: 680, w: 180, h: 36 };
/** The HUD's `MENU` control. */
export const HUD_MENU: Rect = { x: 420, y: 680, w: 120, h: 36 };
/** The HUD's `SOUND` control. */
export const HUD_SOUND: Rect = { x: 556, y: 680, w: 120, h: 36 };

/** A release within this far of its press is a click rather than a drop. */
export const DRAG_THRESHOLD = 5;
/** How long after a press a second one may still pair with it, in seconds. */
export const DOUBLE_CLICK_WINDOW = 0.3;
/** How far from a press a second one may land and still pair with it. */
export const DOUBLE_CLICK_SLOP = 20;

// ---- The deck (specs/deal.md) -------------------------------------------

/** A card's suit. */
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** The four suits, in the order a fresh deck is built in. */
export const SUITS: readonly Suit[] = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
] as const;

/** The Ace, the low rank. */
export const RANK_MIN = 1;
/** The King, the high rank. */
export const RANK_MAX = 13;
/** Cards in one deck. */
export const DECK_SIZE = 52;

/** Tableau columns on the table. */
export const TABLEAU_COLUMNS = 7;
/** Foundations on the table. */
export const FOUNDATION_COUNT = 4;
/** Cards the deal lays into the columns. */
export const DEAL_TABLEAU_CARDS = 28;
/** Cards the deal leaves in the stock. */
export const DEAL_STOCK_CARDS = 24;

// ---- This build's deal mode (specs/stock.md) ----------------------------

/** Cards one turn of the stock moves onto the waste. */
export const TURN_COUNT = 3;
/** The identifier this build reports for its deal mode. */
export const DEAL_MODE = "draw-three";
/** The text this build draws for its deal mode. */
export const DEAL_MODE_LABEL = "DRAW THREE";
/** The pitch the cards of the shown set are fanned to the right at. */
export const WASTE_FAN = 26;
/** How many cards the waste can fan, which is one turn's worth. */
export const WASTE_FAN_MAX = TURN_COUNT;

// ---- The victory cascade (specs/victory.md) -----------------------------

/** Seconds between one launch and the next. */
export const LAUNCH_INTERVAL = 0.18;
/** The upward pop a card launches with. */
export const LAUNCH_VY = -120;
/** The smallest horizontal launch speed. */
export const LAUNCH_VX_MIN = 180;
/** The largest horizontal launch speed. */
export const LAUNCH_VX_MAX = 420;
/** Downward acceleration on a card in flight, per second squared. */
export const GRAVITY = 1800;
/** The share of vertical speed a floor bounce keeps. */
export const BOUNCE_DAMP = 0.8;
/** The `y` a card seated on the floor holds. */
export const FLOOR_Y = STAGE_H - CARD_H;

// ---- Screen copy (specs/screens.md) -------------------------------------

/** The title. */
export const TITLE_TEXT = "CASCADE";
/** The tagline under the title. */
export const TAGLINE_TEXT = "KLONDIKE SOLITAIRE";
/** The title screen's two items, in order. */
export const TITLE_ITEMS = ["NEW GAME", "HOW TO PLAY"] as const;
/** The how-to screen's way back. */
export const HOWTO_BACK_LABEL = "BACK";
/** The HUD's three controls, in order. */
export const HUD_ITEMS = ["NEW GAME", "MENU", "SOUND"] as const;
/** The message the finished cascade leaves over the painted table. */
export const WIN_TEXT = "YOU WIN";

/** The four standalone tokens the how-to screen carries. */
export const HOWTO_TOKENS = ["ACE", "KING", "STOCK", "DOUBLE-CLICK"] as const;

// ---- The debug surface (specs/instrumentation.md) -----------------------

/** The version `window.__cascade` reports. */
export const CASCADE_DEBUG_VERSION = 1;
/** The seed `reset()` uses when it is given none. */
export const DEFAULT_SEED = 1;

// ---- The cues (specs/audio.md) ------------------------------------------

/** The ten cues, under the names specs/audio.md fixes. */
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

/** One of the ten cue names. */
export type CueName = (typeof CUES)[keyof typeof CUES];

/**
 * The order a frame plays the cues it raised in.
 *
 * A frame plays each cue it raised once (specs/audio.md), and it plays them in
 * this order so a frame raising several sounds the same way every time.
 */
export const CUE_ORDER: readonly CueName[] = [
  CUES.deal,
  CUES.turn,
  CUES.recycle,
  CUES.lift,
  CUES.flip,
  CUES.home,
  CUES.drop,
  CUES.reject,
  CUES.launch,
  CUES.win,
] as const;
