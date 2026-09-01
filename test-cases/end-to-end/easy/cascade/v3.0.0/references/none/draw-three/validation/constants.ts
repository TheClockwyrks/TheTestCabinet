// Cascade — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT A DUPLICATE. Under the two
// engines the case seeds `src/constants.ts` into the workspace and the build is
// asked not to edit it, so `validation/simple-2d/` and `validation/structured-2d/`
// import the figures from the build's own tree. An engineless run seeds NO `src/`
// (`specs/overview.md`: "Everything under `src/`. The directory does not exist
// yet."), so there is nothing to import and the figures are restated here, each
// under the name the specification gives it.
//
// NOTHING HERE IS READ FROM A BUILD. That is the whole point. A check that
// compared a build's own constant against itself would grade nothing, and would
// pass a build that named every figure consistently and wrongly. Each value below
// is transcribed from `specs/`, and the spec is authoritative: if a value here
// disagrees with the spec file cited beside it, this file is wrong.
//
// WHAT IS DELIBERATELY ABSENT.
//
//   - THE DEAL-MODE FIGURES. `TURN_COUNT`, `DEAL_MODE`, `DEAL_MODE_LABEL` and
//     `WASTE_FAN` differ between the two variants, so they live in the per-variant
//     validator directories — `draw-one/constants.ts` and
//     `draw-three/constants.ts` — which are the only places a literal turn count
//     appears in this project. A COMMON CHECK NEVER HARD-CODES A TURN COUNT: where
//     a common scenario has to size itself to the deal mode it reads
//     `snapshot().turnCount`, and `draw-one/deal-mode-reported` and
//     `draw-three/deal-mode-reported` separately pin that reading to the
//     specification's figure.
//   - THE CUE NAMES. A cue's name is not observable from outside an engineless
//     build (`audio-init.js` says why at length), so a name no check may assert is
//     a name this file must not carry.
//   - THE PALETTE, THE TYPE AND THE CORNER RADIUS. `specs/` fixes no colour, no
//     font and no rounding: those are the build's. The `presentation` group states
//     its own contrast thresholds beside the figure `specs/` fixes for each.

/** The four suits (`specs/deal.md`). */
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** The two colours a suit is drawn in (`specs/deal.md`). */
export type CardColor = "red" | "black";

/** An axis-aligned rectangle in logical stage units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* -------------------------------------------------------------------------- */
/* The stage and the table (specs/overview.md, specs/table.md)                 */
/* -------------------------------------------------------------------------- */

/** The fixed logical stage the game draws in, 16:9. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** A card's footprint, wherever it sits. Its position is its TOP-LEFT. */
export const CARD_W = 100;
export const CARD_H = 140;

/** The left edge of each of the seven tableau columns, at a pitch of 122. */
export const COLUMN_X = [224, 346, 468, 590, 712, 834, 956] as const;

/** The top row: the stock, the waste, and the four foundations. */
export const TOP_ROW_Y = 24;
export const STOCK_X = 224;
export const WASTE_X = 346;
export const FOUNDATION_X = [590, 712, 834, 956] as const;

/**
 * The third column position, which carries no pile in the top row.
 *
 * `specs/table.md` fixes that nothing card-sized is drawn there under Draw One,
 * and that the only thing over any of it under Draw Three is the right end of
 * the waste's fan. `table/foundation-anchors` reads it.
 */
export const TOP_ROW_GAP_X = 468;

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

/* -------------------------------------------------------------------------- */
/* The controls (specs/controls.md)                                           */
/* -------------------------------------------------------------------------- */

export const TITLE_NEW_GAME: Rect = { x: 480, y: 448, w: 320, h: 52 };
export const TITLE_HOW_TO: Rect = { x: 480, y: 516, w: 320, h: 52 };
export const HOWTO_BACK: Rect = { x: 480, y: 600, w: 320, h: 52 };
export const HUD_NEW_GAME: Rect = { x: 224, y: 680, w: 180, h: 36 };
export const HUD_MENU: Rect = { x: 420, y: 680, w: 120, h: 36 };
export const HUD_SOUND: Rect = { x: 556, y: 680, w: 120, h: 36 };

/**
 * A release within this of its press is a click rather than a drop
 * (`specs/controls.md`).
 *
 * It is a figure, not a tolerance: `handling/drag-threshold` is the one check
 * that grades it, and it states both sides of the rule itself.
 */
export const DRAG_THRESHOLD = 5;

/** The window and the slop the double-click rule is measured with. */
export const DOUBLE_CLICK_WINDOW = 0.3;
export const DOUBLE_CLICK_SLOP = 20;

/**
 * The key that shows and hides the read-only debug overlay
 * (`specs/controls.md`), as a `KeyboardEvent.code`.
 */
export const OVERLAY_KEY = "Backquote";

/**
 * A key `specs/controls.md` binds to nothing.
 *
 * Cascade is played entirely with the pointer and fixes exactly one key binding,
 * {@link OVERLAY_KEY}. Pressing this one is a genuine, browser-trusted gesture
 * that opens a build's audio without touching the game or the overlay, which is
 * what `Harness.armAudio` is for.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* The deck (specs/deal.md)                                                   */
/* -------------------------------------------------------------------------- */

export const SUITS: readonly Suit[] = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
] as const;

/** `1` is the Ace and `13` is the King. */
export const RANK_MIN = 1;
export const RANK_MAX = 13;
export const DECK_SIZE = 52;

export const TABLEAU_COLUMNS = 7;
export const FOUNDATION_COUNT = 4;

export const DEAL_TABLEAU_CARDS = 28;
export const DEAL_STOCK_CARDS = 24;

/* -------------------------------------------------------------------------- */
/* The victory cascade (specs/victory.md)                                     */
/* -------------------------------------------------------------------------- */

/** Seconds between launches. The launch clock carries its remainder. */
export const LAUNCH_INTERVAL = 0.18;
/** The upward pop every launch is given, in logical units per second. */
export const LAUNCH_VY = -120;
/** A launch's horizontal speed is drawn from this range, either sign. */
export const LAUNCH_VX_MIN = 180;
export const LAUNCH_VX_MAX = 420;
/** Downward acceleration, in logical units per second squared. */
export const GRAVITY = 1800;
/** The share of the vertical speed a floor bounce keeps. */
export const BOUNCE_DAMP = 0.8;
/** A card seated on the floor has its bottom edge on the bottom of the stage. */
export const FLOOR_Y = STAGE_H - CARD_H;

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/screens.md)                                             */
/* -------------------------------------------------------------------------- */

export const TITLE_TEXT = "CASCADE";
export const TAGLINE_TEXT = "KLONDIKE SOLITAIRE";
export const TITLE_ITEMS = ["NEW GAME", "HOW TO PLAY"] as const;
export const HOWTO_BACK_LABEL = "BACK";
export const HUD_ITEMS = ["NEW GAME", "MENU", "SOUND"] as const;
export const WIN_TEXT = "YOU WIN";

/**
 * The four tokens `specs/screens.md` requires the how-to screen to carry as
 * standalone words. `screens/howto-copy` matches each at word boundaries; the
 * prose around them is what the captured frame is for.
 */
export const HOWTO_TOKENS = ["ACE", "KING", "STOCK", "DOUBLE-CLICK"] as const;

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md)                               */
/* -------------------------------------------------------------------------- */

export const CASCADE_DEBUG_VERSION = 1;
export const DEFAULT_SEED = 1;
