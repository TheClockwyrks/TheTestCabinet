// Cascade — every figure the specification fixes, named once.
//
// The specs under `specs/` state each of these under the name it carries here,
// and the value stated there is authoritative. Nothing in this file is a choice
// the build made: a number that decides how the game LOOKS lives in
// `src/theme.ts` instead, so the two never blur into each other.
//
// Every position and size is in the fixed logical stage space
// (`specs/overview.md`): the origin is the top-left, `x` grows to the right,
// `y` grows downward, and a card's position is its TOP-LEFT corner.

import type { Rect, Suit } from "./types";

/* ---- The stage and the table (specs/overview.md, specs/table.md) ---------- */

/** The logical design width the game draws in. */
export const STAGE_W = 1280;
/** The logical design height the game draws in. */
export const STAGE_H = 720;

/** A card's footprint, wherever it sits. */
export const CARD_W = 100;
export const CARD_H = 140;

/** The left edge of each of the seven tableau columns, at a pitch of 122. */
export const COLUMN_X = [224, 346, 468, 590, 712, 834, 956] as const;

/** The top row: the stock, the waste, and the four foundations. */
export const TOP_ROW_Y = 24;
export const STOCK_X = 224;
export const WASTE_X = 346;
export const FOUNDATION_X = [590, 712, 834, 956] as const;

/** The top edge of every column's first card. */
export const TABLEAU_Y = 180;

/** How far below a card the next card in a column is drawn. */
export const FACE_DOWN_OFFSET = 24;
export const FACE_UP_OFFSET = 34;
/** The floor a compressed face-up offset never falls below. */
export const FACE_UP_OFFSET_MIN = 14;
/** A column's lowest card's bottom edge may not fall below this line. */
export const COLUMN_BOTTOM_LIMIT = 676;

/** The HUD strip along the bottom of the table. */
export const HUD_Y = 680;
export const HUD_H = 36;

/* ---- The controls (specs/controls.md) ------------------------------------ */

/**
 * The keys `specs/controls.md` binds each of the four menu actions to, as
 * `KeyboardEvent.code` values.
 *
 * The runtime layer reads the keyboard by `code`, so the bindings hold on any
 * layout. An action bound to two codes is one action: either raises it.
 */
export const MENU_UP_KEYS: readonly string[] = ["ArrowUp", "KeyW"];
export const MENU_DOWN_KEYS: readonly string[] = ["ArrowDown", "KeyS"];
export const MENU_CONFIRM_KEYS: readonly string[] = ["Enter", "Space"];
export const MENU_BACK_KEYS: readonly string[] = ["Escape"];

export const TITLE_NEW_GAME: Rect = { x: 480, y: 448, w: 320, h: 52 };
export const TITLE_HOW_TO: Rect = { x: 480, y: 516, w: 320, h: 52 };
export const HOWTO_BACK: Rect = { x: 480, y: 600, w: 320, h: 52 };
export const HUD_NEW_GAME: Rect = { x: 224, y: 680, w: 180, h: 36 };
export const HUD_MENU: Rect = { x: 420, y: 680, w: 120, h: 36 };
export const HUD_SOUND: Rect = { x: 556, y: 680, w: 120, h: 36 };

/** A release within this of its press is a click rather than a drop. */
export const DRAG_THRESHOLD = 5;
/** The window and the slop the double-click rule is measured with. */
export const DOUBLE_CLICK_WINDOW = 0.3;
export const DOUBLE_CLICK_SLOP = 20;

/* ---- The deck (specs/deal.md) -------------------------------------------- */

export const SUITS: readonly Suit[] = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
] as const;

export const RANK_MIN = 1;
export const RANK_MAX = 13;
export const DECK_SIZE = 52;

export const TABLEAU_COLUMNS = 7;
export const FOUNDATION_COUNT = 4;

export const DEAL_TABLEAU_CARDS = 28;
export const DEAL_STOCK_CARDS = 24;

/* ---- This build's deal mode (specs/stock.md) ----------------------------- */

/** Cards one turn of the stock moves onto the waste. */
export const TURN_COUNT = 1;
/** The identifier this build reports for its deal mode. */
export const DEAL_MODE = "draw-one";
/** The text this build draws on the title screen and in the HUD. */
export const DEAL_MODE_LABEL = "DRAW ONE";

/* ---- The victory cascade (specs/victory.md) ------------------------------ */

export const LAUNCH_INTERVAL = 0.18;
export const LAUNCH_VY = -120;
export const LAUNCH_VX_MIN = 180;
export const LAUNCH_VX_MAX = 420;
export const GRAVITY = 1800;
export const BOUNCE_DAMP = 0.8;
/** A card seated on the floor has its bottom edge on the bottom of the stage. */
export const FLOOR_Y = STAGE_H - CARD_H;

/* ---- Screen copy (specs/screens.md) -------------------------------------- */

export const TITLE_TEXT = "CASCADE";
export const TAGLINE_TEXT = "KLONDIKE SOLITAIRE";
export const TITLE_ITEMS = ["NEW GAME", "HOW TO PLAY"] as const;
export const HOWTO_BACK_LABEL = "BACK";
export const HUD_ITEMS = ["NEW GAME", "MENU", "SOUND"] as const;
export const WIN_TEXT = "YOU WIN";

/**
 * The four tokens `specs/screens.md` requires the how-to screen to carry as
 * standalone words, held here so the copy in `src/render.ts` and the test that
 * guards it read the same list.
 */
export const HOWTO_TOKENS = ["ACE", "KING", "STOCK", "DOUBLE-CLICK"] as const;

/* ---- The debug surface (specs/instrumentation.md) ------------------------ */

export const CASCADE_DEBUG_VERSION = 1;

/* ---- Audio (specs/audio.md) ---------------------------------------------- */

/** The ten cues, under exactly the names the specification fixes. */
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
