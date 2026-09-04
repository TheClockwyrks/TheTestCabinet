// Cascade — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT A DUPLICATE. `specs/overview.md`
// requires the build to write "`src/constants.ts`, holding every figure this
// specification fixes", and to export each one "under the name this specification
// gives it". So under an engine there IS a module beside the game carrying a
// `CARD_W`, a `LAUNCH_INTERVAL` and a `TURN_COUNT` — and every one of them is the
// BUILD's claim about itself, written by the thing this project grades. The
// engine workspaces do SEED that module — it arrives headed "Supplied with the
// project. Do not edit." — but seeding it is the last thing that touches it: no
// contract pins it, nothing re-checks that the copy in a produced tree is still
// the seeded one, and nothing outside these checks reads it back against the
// specification. A build that edited a figure there would be graded against its
// own edit.
//
// A CHECK THAT IMPORTED ITS FIGURE FROM THERE WOULD GRADE NOTHING. The comparison
// would reduce to "does the build do what the build says it does", which is true
// of every build, including one that named a figure consistently and wrongly: a
// build that fans its waste at a pitch of 29 and writes `WASTE_FAN = 29` matches
// itself exactly, on every frame, forever. Each value below is transcribed from
// `specs/` instead, and the spec is authoritative: if a value here disagrees with
// the spec file cited beside it, this file is wrong.
//
// NO FIGURE HERE IS READ FROM THE BUILD, and exactly one value is. Every figure
// below — every position, every count, every threshold's subject — is
// transcribed from `specs/` by hand, and the spec is authoritative: if a value
// here disagrees with the spec file cited beside it, this file is wrong.
//
// The one value read from the build is `BACKGROUND`, and the last section of
// this file says why: `specs/` fixes no palette, so the ground the build clears
// its stage to is the build's own, and a reading that asks whether two things
// the build drew stand apart has to know which colour is the ground. It grades
// nothing. This is the ONE file in the project permitted to reach into `../src/`,
// and it takes that one binding by name.
//
// WHAT IS DELIBERATELY ABSENT.
//
//   - THE DEAL-MODE FIGURES. `TURN_COUNT`, `DEAL_MODE`, `DEAL_MODE_LABEL` and
//     `WASTE_FAN` differ between the two variants, and one project grades both, so
//     a single figure here would be wrong for one of them. They belong to the
//     per-variant directories: `draw-one/` and `draw-three/` are the only places a
//     literal turn count or fan pitch appears. A COMMON CHECK NEVER HARD-CODES
//     ONE: where a common scenario has to size itself to the deal mode it reads
//     `snapshot().turnCount` or `snapshot().dealMode`, which
//     `draw-one/turn-count`, `draw-three/turn-count` and both
//     `deal-mode-reported` points separately pin to the specification's figures.
//   - THE PALETTE, THE TYPE AND THE CORNER RADIUS. `specs/` fixes no colour, no
//     font and no rounding: those are the build's. The `presentation` group states
//     its own contrast thresholds beside the figure `specs/` fixes for each.

import type { Suit } from "./surface";

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
export const COLUMN_X: readonly number[] = [224, 346, 468, 590, 712, 834, 956];

/** The top row: the stock, the waste, and the four foundations. */
export const TOP_ROW_Y = 24;
export const STOCK_X = 224;
export const WASTE_X = 346;
export const FOUNDATION_X: readonly number[] = [590, 712, 834, 956];

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

/**
 * A release within this of its press is a click rather than a drop
 * (`specs/controls.md`).
 *
 * It is a figure, not a tolerance: `handling/short-gesture-is-a-click` and
 * `handling/long-gesture-is-a-drop` are the two checks that grade it, and each
 * states its own side of the rule.
 */
export const DRAG_THRESHOLD = 5;

/** The window and the slop the double-click rule is measured with. */
export const DOUBLE_CLICK_WINDOW = 0.3;
export const DOUBLE_CLICK_SLOP = 20;

/* -------------------------------------------------------------------------- */
/* The menus (specs/controls.md, specs/screens.md)                            */
/* -------------------------------------------------------------------------- */
//
// WHERE the items sit is NOT here, and must not be. `specs/controls.md` leaves
// each control's hit region to the build — "Each control occupies a rectangular
// hit region the build lays out" — and has the build report it through
// `menuItemRect`. So a check aims at the region the build answered with, and the
// only thing this file fixes about a menu is its ORDER, which the specification
// does fix: the controls of a screen are that screen's menu "in the order the
// table above gives them".

/** The two items of the title menu, in `TITLE_ITEMS` order. */
export const TITLE_NEW_GAME_ITEM = 0;
export const TITLE_HOW_TO_ITEM = 1;

/** The how-to screen's one item, labelled `HOWTO_BACK_LABEL`. */
export const HOWTO_BACK_ITEM = 0;

/** The three items of the HUD's menu, in `HUD_ITEMS` order. */
export const HUD_NEW_GAME_ITEM = 0;
export const HUD_MENU_ITEM = 1;
export const HUD_SOUND_ITEM = 2;

/**
 * The keys `specs/controls.md` binds each of the four menu actions to, as
 * `KeyboardEvent.code` values.
 *
 * An action bound to two codes is one requirement: both raise the same action and
 * exercise the same rule the same way, so a point drives both and a build that
 * bound only one of a pair fails it.
 */
export const MENU_UP_KEYS = ["ArrowUp", "KeyW"] as const;
export const MENU_DOWN_KEYS = ["ArrowDown", "KeyS"] as const;
export const MENU_CONFIRM_KEYS = ["Enter", "Space"] as const;
export const MENU_BACK_KEY = "Escape";

/* -------------------------------------------------------------------------- */
/* The deck (specs/deal.md)                                                   */
/* -------------------------------------------------------------------------- */

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];

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
export const HUD_ITEMS = ["NEW GAME", "MENU", "SOUND"] as const;
export const HOWTO_BACK_LABEL = "BACK";
export const WIN_TEXT = "YOU WIN";

/**
 * The four tokens `specs/screens.md` requires the how-to screen to carry as
 * standalone words. `screens/howto-copy` matches each at word boundaries; the
 * prose around them is what the captured frame is for.
 */
export const HOWTO_TOKENS = ["ACE", "KING", "STOCK", "DOUBLE-CLICK"] as const;

/* -------------------------------------------------------------------------- */
/* The audio cues (specs/audio.md)                                            */
/* -------------------------------------------------------------------------- */

/**
 * The ten cue names, one per event, exactly as the table in `specs/audio.md`
 * fixes them.
 *
 * Under an engine the game asks the engine's cue bus for a cue BY NAME and the
 * bus announces the play, so the name is observable and every `audio/cue-*` point
 * asserts it. `specs/audio.md` requires the build to "define and play exactly the
 * ten cues in `CUES`, under exactly these names", which is what makes each name
 * below the specification's and not the build's.
 */
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

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md)                               */
/* -------------------------------------------------------------------------- */

/** The version the surface reports, as a plain number. */
export const CASCADE_DEBUG_VERSION = 1;

/** The seed `reset()` uses when the caller names none. */
export const DEFAULT_SEED = 1;

/* ---- What the specification leaves to the build --------------------------- */
//
// ONE VALUE, AND IT GRADES NOTHING. `specs/screens.md` and `specs/table.md` fix
// no palette: "The palette, the type, and the layout of each screen are yours."
// So the colour the build clears its stage to is the build's own choice, and a
// check that compared it against a figure would be failing a build for a
// decision the specification handed it.
//
// What the checks need it for is the opposite of a comparison: it LOCATES what
// the build drew. A reading that asks whether a card, a highlight or a string
// stands apart from what sits behind it has to know which of the two colours it
// is looking at is the ground, and the build is the only thing that can say. So
// `harness.ts` takes it from here to clear its own offscreen surface to the same
// ground the build draws over, and every distance a check then measures is
// between two things the build itself painted.
//
// This is the ONE file in the project permitted to import from `../src/`, and
// this is the one binding it takes. It is taken BY NAME rather than through a
// namespace or a re-export of the whole module, so the list of what this project
// reads off the build is one line long and stays that way.

export { BACKGROUND } from "../src/game";
