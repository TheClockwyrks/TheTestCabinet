// Facet — every figure the specification fixes, stated by the CASE.
//
// SHARED FILE. This module is byte-identical in `validation/none/`,
// `validation/simple-2d/` and `validation/structured-2d/`. It is copied between
// the three rather than re-derived, so one figure means one thing in all three
// suites and a check written against one engine reads the same as the check
// written against another. An edit belongs in all three copies at once; two
// copies that differ are a defect in the case, not a local adjustment.
//
// WHY THE CASE STATES ITS OWN FIGURES RATHER THAN IMPORTING `../src/constants`.
// Two reasons, and either one alone would settle it.
//
//  1. A build is held to the SPECIFICATION, never to its own reading of it.
//     Under the two engines a `src/constants.ts` carrying these numbers is
//     seeded and marked "do not edit" — but a build is able to edit any file it
//     was given, and a check that imported the build's copy would grade a build
//     against itself. An edited constant would move the target instead of
//     failing a point.
//  2. The `none` workspace seeds no `src/` at all — a build standing on no
//     engine writes its own — so under that engine there is nothing to import.
//
// Every value below names the spec file that fixes it, under the name that
// specification gives it, and the pairing is deliberate: `STEP_SECONDS` here is
// `specs/rules.md`'s step, so a build that holds the board for some other
// interval fails the point rather than moving the target.
//
// FOUR GROUPS ARE NOT SPEC FIGURES, and each says so where it sits: the suite's
// own frame schedule, its sampling tolerances, the stand-in a harness falls back
// to when a build exported nothing, and the values that are real but valid under
// some engines only (`LAYOUT`, `OVERLAY_KEY`).
//
// Every position and size is in the fixed 1280x720 logical stage
// `specs/overview.md` defines (origin top-left, `x` to the right, `y` down),
// every rate is per second, and every duration is in seconds.

/* -------------------------------------------------------------------------- */
/* The stage — specs/overview.md                                              */
/* -------------------------------------------------------------------------- */

/** The logical design size every coordinate here is stated in. 16:9. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center, `(STAGE_CX, STAGE_CY)`. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

/* -------------------------------------------------------------------------- */
/* The board — specs/board.md                                                 */
/* -------------------------------------------------------------------------- */

/** The grid a board is dealt on. `col` runs left to right, `row` top down. */
export const GRID_COLS = 8;
export const GRID_ROWS = 8;

/** Adjacent cell centers are this far apart on both axes. */
export const CELL_PITCH = 72;

/**
 * The point the grid is centered on, from which specs/board.md derives
 *
 *   cellX(col) = BOARD_CX - (GRID_COLS - 1) * CELL_PITCH / 2 + col * CELL_PITCH
 *   cellY(row) = BOARD_CY - (GRID_ROWS - 1) * CELL_PITCH / 2 + row * CELL_PITCH
 *
 * so centers run `x` `388..892` and `y` `144..648`. `board.ts` writes the
 * formulas down; this file holds only the figures they are built from.
 */
export const BOARD_CX = 640;
export const BOARD_CY = 396;

/** Every gem's drawn form fits inside this radius of its cell center. */
export const GEM_R = 30;

/**
 * A cell is targeted by the pointer within this radius of its center.
 *
 * It is half of `CELL_PITCH`, so at most one center lies strictly inside it, and
 * a position lying exactly this far from two centers is settled by
 * specs/controls.md — the lower row, and within one row the lower column.
 */
export const GEM_HIT_R = 36;

/* -------------------------------------------------------------------------- */
/* Gems — specs/board.md                                                      */
/* -------------------------------------------------------------------------- */

/** The seven kinds, in the order specs/board.md holds them "in this order". */
export const GEM_KINDS = [
  "ruby",
  "amber",
  "citrine",
  "jade",
  "beryl",
  "sapphire",
  "amethyst",
] as const;

/** One of the seven kinds. Derived here so the union has a single home. */
export type GemKind = (typeof GEM_KINDS)[number];

/** How many kinds there are, and how many a refill draws from. */
export const GEM_KIND_COUNT = 7;

/**
 * The four cuts, in the order specs/board.md holds them "in this order".
 * `plain` is the ordinary one, and a `prism` carries no kind at all.
 */
export const CUTS = ["plain", "brilliant", "star", "prism"] as const;

/** One of the four cuts. Derived here so the union has a single home. */
export type Cut = (typeof CUTS)[number];

/** Strain runs `0..MAX_STRAIN`, and a gem at `MAX_STRAIN` is flawed. */
export const MAX_STRAIN = 3;

/* -------------------------------------------------------------------------- */
/* The ruleset — specs/rules.md                                               */
/* -------------------------------------------------------------------------- */

/** The shortest line of one kind that counts as a run, under R4. */
export const MATCH_MIN = 3;

/** How long a chain step holds the board before the next one is read. */
export const STEP_SECONDS = 0.25;

/** How long the mark on a refused swap stands on its two cells. */
export const REFUSAL_SECONDS = 0.3;

/** What a cleared gem at strain `0` to `2` is worth, before the multiplier. */
export const BASE_SCORE = 10;

/** What a cleared gem at `MAX_STRAIN` is worth, before the multiplier. */
export const FLAWED_SCORE = 20;

/** The step's multiplier is `M = min(chainStep, MAX_MULTIPLIER)`. */
export const MAX_MULTIPLIER = 8;

/** The level target is `LEVEL_TARGET_STEP` times the level, counting from 1. */
export const LEVEL_TARGET_STEP = 2000;

/* -------------------------------------------------------------------------- */
/* Screens and screen copy — specs/ui.md                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every screen `state.screen` names.
 *
 * specs/ui.md fixes the SET — "one of `title`, `howto`, `playing`, `paused`, and
 * `gameover`" — and no order over it. The order below is the order that sentence
 * lists them in, and nothing asserts it: a check reads membership.
 */
export const SCREENS = [
  "title",
  "howto",
  "playing",
  "paused",
  "gameover",
] as const;

/** One of the five screens. Derived here so the union has a single home. */
export type Screen = (typeof SCREENS)[number];

export const TITLE_TEXT = "FACET";
export const TAGLINE_TEXT = "PRESSURE FINDS THE FLAW";

/** The title menu, in that order. */
export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"] as const;

/** The pause screen: its heading, and its menu in that order. */
export const PAUSED_TITLE_TEXT = "PAUSED";
export const PAUSED_ITEMS = ["RESUME", "QUIT"] as const;

/** The end of a round: its heading, and its menu in that order. */
export const GAMEOVER_TITLE_TEXT = "NO MOVES LEFT";
export const GAMEOVER_ITEMS = ["PLAY AGAIN", "QUIT"] as const;

/**
 * The labeled readouts on the `playing` screen. `CHAIN` shows
 * `state.multiplier` while `phase` is `resolving` and is absent while it is
 * `idle`, which is what makes it the one readout with an absence to check.
 */
export const HUD_SCORE_LABEL = "SCORE";
export const HUD_LEVEL_LABEL = "LEVEL";
export const HUD_CHAIN_LABEL = "CHAIN";

/* -------------------------------------------------------------------------- */
/* Audio cues — specs/ui.md                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The eight cue names, one per event, under exactly the constant name
 * specs/ui.md gives each.
 *
 * The NAME is observable under the two engines, where the game asks the engine's
 * bus for a cue by name and the bus announces the play. It is not observable
 * under `none`, where the whole audio layer is the build's own and the
 * specification says nothing about how a build makes a sound — so a `none` check
 * asserts that a one-shot sounded and on which frame, never which cue it was.
 *
 * A cue check asserts CONTAINMENT and never exclusivity. specs/ui.md has `clear`
 * sound the chain ladder, and calls the rungs "that one cue's sources rather
 * than events of their own", so a build is entitled to name a rung on the bus
 * beside the cue itself.
 */
export const CUES = {
  select: "select",
  swap: "swap",
  refuse: "refuse",
  clear: "clear",
  flaw: "flaw",
  cut: "cut",
  levelUp: "levelup",
  gameOver: "gameover",
} as const;

/** One of the eight cue names. Derived here so the union has a single home. */
export type CueName = (typeof CUES)[keyof typeof CUES];

/**
 * The eight names as a list, for a check that sweeps them.
 *
 * In the order specs/ui.md tables them. The table fixes which event plays which
 * cue and nothing about order, so nothing asserts this sequence.
 */
export const CUE_NAMES = [
  CUES.select,
  CUES.swap,
  CUES.refuse,
  CUES.clear,
  CUES.flaw,
  CUES.cut,
  CUES.levelUp,
  CUES.gameOver,
] as const;

/* -------------------------------------------------------------------------- */
/* Input — specs/controls.md                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The touch layout the two engine workspaces stand the game up with.
 *
 * NOT a figure any spec states. It is fixed by the seeded, do-not-edit
 * `src/constants.ts` of the `simple-2d` and `structured-2d` workspaces, and the
 * equally seeded `src/main.ts` hands it to the engine. A harness passes the same
 * value so it stands the game up exactly as the build's own entry point does;
 * nothing asserts it. Under `none` there is no engine and it is unused.
 */
export const LAYOUT = "dpad-4";

/**
 * The eight actions the game registers, in the order the seeded, do-not-edit
 * `src/constants.ts` of the two engine workspaces declares them.
 *
 * The specification fixes the SET of actions and what each one does. It does not
 * fix an order — it is explicit where it means one ("`GEM_KINDS` holds the seven
 * kinds in this order", "`PLAY`, `HOW TO PLAY`, in that order") and says nothing
 * of the kind here. So no check may assert this sequence, and a check that needs
 * an action reaches for it by name.
 *
 * Under the two engines the vocabulary is the engine's `dpad-4` layout plus the
 * menu actions it appends, which registers these same eight in this same
 * sequence. Under `none` the build registers them itself and any order it
 * reaches them in conforms — which is why the sequence is evidence of nothing.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

/** One of the eight actions. Derived here so the union has a single home. */
export type ActionName = (typeof ACTIONS)[number];

/** The cell the cursor occupies when a round opens. */
export const CURSOR_START_COL = 0;
export const CURSOR_START_ROW = 0;

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character.
 *
 * specs/controls.md fixes this whole table — every action, every key — for a
 * build of every engine, so there is one binding table here and it is as valid
 * under `none` as under the two engines. A check may press a key for any of the
 * eight actions whatever the build was stood up on.
 *
 * Each key listed for an action fires that action on its own. A check presses an
 * action's FIRST binding; the alternate is listed beside it so a check may prove
 * the second key works as well.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

/**
 * The key that shows and hides the debug overlay, valid under `none` ALONE.
 *
 * specs/instrumentation.md fixes it there — "the backtick key
 * (`KeyboardEvent.code` `Backquote`)" — because under `none` the overlay is part
 * of the runtime layer the build writes. Under the two engines the overlay and
 * its key are the engine's, and this is not the build's business.
 */
export const OVERLAY_KEY = "Backquote";

/**
 * A key this case binds to nothing, for a check that needs a GENUINE browser
 * gesture without changing any game state — arming a build's audio, which a
 * browser opens only after a real interaction.
 *
 * THE CASE'S CHOICE, not a specification figure. `F8` appears nowhere in
 * {@link BINDINGS}, which is the whole of what specs/controls.md binds, so
 * pressing it reaches no action a check is reading.
 */
export const UNBOUND_KEY = "F8";

/* -------------------------------------------------------------------------- */
/* The debug surface — specs/instrumentation.md                               */
/* -------------------------------------------------------------------------- */

/** The version the surface carries as `version`. */
export const FACET_DEBUG_VERSION = 1;

/** The seed `reset()` applies when the caller names none. */
export const DEFAULT_SEED = 1;

/**
 * The global an engineless build installs its finished surface on,
 * `window.__facet`. Under the two engines the surface is returned from
 * `initialize` and reached off `engine.debug`, and nothing is installed on a
 * page.
 */
export const HANDLE = "__facet";

/* -------------------------------------------------------------------------- */
/* A stand-in for a missing export — THE CASE'S OWN                           */
/* -------------------------------------------------------------------------- */

/**
 * The stage background a harness stands the game up with when a build exported
 * none.
 *
 * specs/overview.md makes `BACKGROUND` a deliverable of `src/game.ts` and has
 * `src/main.ts` hand it to the engine as the color the canvas is cleared to. A
 * build that never exported it must still be STOOD UP, so its other points can
 * be decided rather than all failing at a module import. Nothing asserts this
 * value and no check reads it; the missing export lands on the checks that are
 * about it.
 */
export const BACKGROUND_FALLBACK = "#000000";

/* -------------------------------------------------------------------------- */
/* The suite's own frame schedule — NOT specification figures                 */
/* -------------------------------------------------------------------------- */
//
// The specification fixes no frame rate at all: every duration in this game is
// counted against the delta time the update is handed, so a build must reach the
// same place however that time was divided. The suite therefore chooses the size
// of a frame, and chooses one that makes the specification's durations exact.

/** Frames per second of simulated time the suite drives at. */
export const TICK_HZ = 64;

/** One frame of the suite's clock, in seconds and in milliseconds. */
export const TICK_S = 0.015625;
export const TICK_MS = 15.625;

/**
 * Frames of the suite's clock that sum to exactly `STEP_SECONDS`.
 *
 * 64 Hz rather than 60 because both `TICK_S` and `STEP_SECONDS` are exactly
 * representable in binary at this rate: sixteen frames of `0.015625` s sum to
 * `0.25` s with no floating-point residue at all. At 60 Hz they do not, and a
 * check about the step cadence would be reading the residue rather than the
 * build.
 */
export const FRAMES_PER_STEP = 16;

/**
 * Frames that carry `stepTimer` past `STEP_SECONDS` and short of two steps.
 *
 * 17 frames is `0.265625` s: past `0.25` whether the build compares `>=` or `>`,
 * and well short of `0.5`, so exactly one further board read happens. A build
 * that reads the board more than once in `STEP_SECONDS` does not conform, and
 * this drive shows that as an extra chain step rather than hiding it.
 */
export const STEP_DRIVE_FRAMES = 17;

/** 19 frames is `0.296875` s: still inside `REFUSAL_SECONDS` (`0.3`). */
export const REFUSAL_FRAMES_BEFORE = 19;

/**
 * 20 frames is `0.3125` s: past `REFUSAL_SECONDS` (`0.3`) whether the build
 * compares `>=` or `>`.
 */
export const REFUSAL_FRAMES_AFTER = 20;

/**
 * The most chain steps a settle is driven for before it is called unsettled.
 *
 * A cap rather than a wait: a build whose chain never ends fails its own item,
 * reported as `settled: false`, instead of costing the whole run the suite's
 * wall-clock cap. 64 steps is far more than a board of 64 cells can produce.
 */
export const MAX_CHAIN_STEPS = 64;

/** The most frames a written replay holds. */
export const MAX_REPLAY_FRAMES = 300;

/* -------------------------------------------------------------------------- */
/* The suite's own sampling tolerances — NOT specification figures            */
/* -------------------------------------------------------------------------- */
//
// specs/board.md requires that the seven kinds, the four cuts and the four
// strain states be told apart, and fixes no palette, no form and no style. These
// are the numbers this suite reads that requirement at, so no check here asserts
// a hue, a layout, or a style — only that two things a player must tell apart
// are drawn differently, and by how much.

/**
 * Half the side of the pixel box a cell's appearance is read from.
 *
 * 20 gives a 41x41 box centered on the cell center: inside `GEM_R` (`30`), so it
 * lands on the gem rather than on whatever the board draws around it, and well
 * inside half of `CELL_PITCH` (`36`), so no neighbor's gem reaches into it.
 */
export const PATCH_HALF = 20;

/**
 * The mean per-pixel RGB distance (`0..441`) at which two patches are told
 * apart.
 *
 * Deliberately low. The measure registers a hue difference and a form difference
 * alike, so a build that tells two kinds apart by silhouette on one palette is
 * not failed for having chosen a quiet palette; what it rules out is a build
 * that draws two of them identically. Large enough that anti-aliasing, an idle
 * animation phase, or compression noise does not reach it.
 */
export const PATCH_DISTINCT_MIN = 12;

/**
 * The distance below which two patches are the same picture — the control
 * reading a check about telling two things apart is measured against. Not zero,
 * because a build is entitled to an idle animation.
 */
export const PATCH_SAME_MAX = 2;
