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
// `specs/rules.md`'s rest span, so a build that holds the board for some other
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

/**
 * How long an accepted swap is in motion before its first chain step resolves.
 *
 * The exchange happens at once and `phase` becomes `swapping`; this is the game
 * time that stands between it and step 1, and the overrun past it carries into
 * `stepTimer` so the cadence is independent of how time was divided.
 */
export const SWAP_SECONDS = 0.18;

/**
 * How long one wave of a shattering clear set is behind the wave before it.
 *
 * R6 gives every cell of the set a wave, `0` for the seed and one more for each
 * addition that reached it, and the cell at wave `w` shatters `w` of these into
 * the step. `board.ts`'s clear set reports those waves.
 */
export const WAVE_SECONDS = 0.08;

/** How long a falling gem takes per row it fell, under R9. */
export const FALL_SECONDS_PER_ROW = 0.05;

/**
 * How long a chain step rests once its gems have landed, before the board is
 * read again.
 *
 * It is the last of a step's three spans rather than the whole of its hold,
 * which is
 * `lastWaves * WAVE_SECONDS + lastFall * FALL_SECONDS_PER_ROW + STEP_SECONDS`
 * and is the step's own figure rather than a constant. `board.ts`'s `stepHold`
 * is that arithmetic written down.
 */
export const STEP_SECONDS = 0.25;

/**
 * A step whose longest fall was longer than this many rows plays `land`.
 *
 * Strictly longer, as specs/ui.md words it, so a step whose `lastFall` is
 * exactly this plays nothing and a step at one more plays the cue.
 */
export const LAND_MIN_ROWS = 2;

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
 * specs/ui.md fixes the SET — "one of `title`, `howto`, `playing`, `paused`,
 * `levelclear`, and `gameover`" — and no order over it. The order below is the
 * order that sentence lists them in, and nothing asserts it: a check reads
 * membership.
 */
export const SCREENS = [
  "title",
  "howto",
  "playing",
  "paused",
  "levelclear",
  "gameover",
] as const;

/** One of the six screens. Derived here so the union has a single home. */
export type Screen = (typeof SCREENS)[number];

export const TITLE_TEXT = "FACET";
export const TAGLINE_TEXT = "PRESSURE FINDS THE FLAW";

/** The title menu, in that order. */
export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"] as const;

/** The pause screen: its heading, and its menu in that order. */
export const PAUSED_TITLE_TEXT = "PAUSED";
export const PAUSED_ITEMS = ["RESUME", "QUIT"] as const;

/** The end of a level: its heading, and its menu in that order. */
export const LEVELCLEAR_TITLE_TEXT = "LEVEL CLEAR";
export const LEVELCLEAR_ITEMS = ["CONTINUE", "QUIT"] as const;

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

/**
 * The two figures a finished level is totted up by, on `levelclear`, each drawn
 * beside the label named here.
 */
export const BEST_CHAIN_LABEL = "LONGEST CHAIN";
export const BEST_MOVE_LABEL = "BEST MOVE";

/**
 * The two on-screen controls a player with only a pointer reaches a screen
 * through: the one that raises the pause menu from the board, and the one that
 * leaves `howto`. Each carries the pointer target of the same name.
 */
export const PAUSE_LABEL = "PAUSE";
export const BACK_LABEL = "BACK";

/* -------------------------------------------------------------------------- */
/* Pointer targets — specs/controls.md                                        */
/* -------------------------------------------------------------------------- */

/**
 * The least a pointer target may measure, on each axis.
 *
 * specs/controls.md fixes both as a floor rather than a size: a target of
 * exactly these dimensions conforms and so does one twice as large, so a check
 * reads a reported rectangle against these and never for equality with them.
 * They exist because a fingertip covers far more of a touchscreen than a cursor
 * covers of a monitor, and the board is played by touch as readily as by mouse.
 */
export const TARGET_MIN_W = 96;
export const TARGET_MIN_H = 72;

/* -------------------------------------------------------------------------- */
/* Audio cues — specs/ui.md                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The nine cue names, one per event, under exactly the constant name
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
  land: "land",
  flaw: "flaw",
  cut: "cut",
  levelUp: "levelup",
  gameOver: "gameover",
} as const;

/** One of the nine cue names. Derived here so the union has a single home. */
export type CueName = (typeof CUES)[keyof typeof CUES];

/**
 * The nine names as a list, for a check that sweeps them.
 *
 * In the order specs/ui.md tables them. The table fixes which event plays which
 * cue and nothing about order, so nothing asserts this sequence.
 */
export const CUE_NAMES = [
  CUES.select,
  CUES.swap,
  CUES.refuse,
  CUES.clear,
  CUES.land,
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
 *
 * It is the one-slider layout because the board is played with the pointer and
 * the keyboard's whole job is the menus, so `up` and `down` are the whole of the
 * movement vocabulary the game needs.
 */
export const LAYOUT = "single-vertical";

/**
 * The six actions the game registers, in the order the seeded, do-not-edit
 * `src/constants.ts` of the two engine workspaces declares them.
 *
 * The specification fixes the SET of actions and what each one does. It does not
 * fix an order — it is explicit where it means one ("`GEM_KINDS` holds the seven
 * kinds in this order", "`PLAY`, `HOW TO PLAY`, in that order") and says nothing
 * of the kind here. So no check may assert this sequence, and a check that needs
 * an action reaches for it by name.
 *
 * Under the two engines the vocabulary is the engine's `single-vertical` layout
 * plus the menu actions it appends, which registers these same six in this same
 * sequence. Under `none` the build registers them itself and any order it
 * reaches them in conforms — which is why the sequence is evidence of nothing.
 */
export const ACTIONS = [
  "up",
  "down",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

/** One of the six actions. Derived here so the union has a single home. */
export type ActionName = (typeof ACTIONS)[number];

/**
 * The three devices that drive the pointer, all on one path.
 *
 * specs/controls.md has a mouse, a pen and a finger read the same way, so the
 * device is reported and nothing else about a press depends on it. The order is
 * the order that file names them in, and nothing asserts it.
 */
export const POINTER_DEVICES = ["mouse", "pen", "touch"] as const;

/** One of the three devices. Derived here so the union has a single home. */
export type PointerDevice = (typeof POINTER_DEVICES)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character.
 *
 * specs/controls.md fixes this whole table — every action, every key — for a
 * build of every engine, so there is one binding table here and it is as valid
 * under `none` as under the two engines. A check may press a key for any of the
 * six actions whatever the build was stood up on.
 *
 * Each key listed for an action fires that action on its own. A check presses an
 * action's FIRST binding; where a second is listed it is the alternate, and a
 * check may prove it works as well.
 *
 * `Escape` is listed twice on purpose, under `back` and under `pause`. The two
 * act on screens that do not overlap — `pause` on `playing` and `paused` alone,
 * `back` on `howto` and `gameover` alone — so a frame that fires both is
 * unambiguous whichever order a build applies them in, and a check that presses
 * `Escape` reads the one action the screen it pressed on carries.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
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
/* The produced assets — specs/assets.md                                      */
/* -------------------------------------------------------------------------- */
//
// Every figure specs/assets.md fixes about what a build PRODUCES, transcribed
// under the names that file uses. The `assets/` suites read their counts from
// here rather than each writing its own, so a figure that moves in the
// specification moves once and the three projects cannot come to disagree about
// it. What is NOT here is a suite's own sampling parameters — the side of a
// contact-sheet cell, the height of a filmstrip frame, the RMS floor a check
// calls silence — because those are the check's own choices and no
// specification sentence fixes them.

/**
 * How many distinct sprites specs/assets.md's `draw` bullets ask for.
 *
 * "The seven kinds at each of four strain states" is twenty-eight; "the
 * `brilliant` and the `star` treatments" are two overlays; "the `prism` at each
 * of four strain states" is four; "The board frame, one sprite" is one.
 */
export const REQUIRED_SPRITES = 7 * 4 + 2 + 4 + 1;

/** specs/assets.md: "A break animation for each of the seven kinds." */
export const REQUIRED_BREAK_SHEETS = 7;

/**
 * The fewest files a sequence of separate frames can be made of.
 *
 * specs/assets.md asks for "a short sequence" per kind and fixes no length, so
 * this is the floor at which a sequence is a sequence at all rather than a
 * count the specification states.
 */
export const MIN_SHEET_FRAMES = 2;

/**
 * specs/assets.md: "Produce these four" — the clear burst, the flawed
 * detonation, the cut-gem flash, and the cut aura.
 */
export const REQUIRED_FX_SYSTEMS = 4;

/** The cues specs/assets.md names one by one for `sfx-synth` to produce. */
export const SYNTH_CUES = [
  "select",
  "swap",
  "refuse",
  "land",
  "flaw",
  "cut",
  "levelup",
  "gameover",
] as const;

/** The shatter body `sfx-sample` produces: one file. */
export const SAMPLED_BODIES = 1;

/**
 * specs/assets.md: "Produce two pieces: a title theme with a hook, and a slower
 * play bed."
 */
export const MUSIC_PIECES = 2;

/**
 * The served tree specs/assets.md commits every produced file under.
 *
 * "a file committed at `public/assets/gems/ruby.png` is served at
 * `assets/gems/ruby.png` beside the page", so these are the paths a check
 * addresses the produced tree by, relative to the served root.
 */
export const ASSETS_DIR = "assets";

/** specs/assets.md: "Land them under `public/assets/gems/`." */
export const GEMS_DIR = [ASSETS_DIR, "gems"] as const;

/** specs/assets.md: the particle systems land "under `public/assets/fx/`". */
export const FX_DIR = [ASSETS_DIR, "fx"] as const;

/** specs/assets.md: the `.wav`s land "under `public/assets/audio/`". */
export const AUDIO_DIR = [ASSETS_DIR, "audio"] as const;

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

/**
 * One frame of the suite's clock, in seconds and in milliseconds.
 *
 * This is the figure a harness divides a duration by when it needs the frames
 * that cover it. A step's hold is the case in point: it is the step's own
 * arithmetic rather than a constant, so a harness that drives a step to its end
 * takes the hold from `board.ts`'s `stepHold` and counts frames from here.
 */
export const TICK_S = 0.015625;
export const TICK_MS = 15.625;

/**
 * Frames of the suite's clock that sum to exactly `STEP_SECONDS`.
 *
 * 64 Hz rather than 60 because both `TICK_S` and `STEP_SECONDS` are exactly
 * representable in binary at this rate: sixteen frames of `0.015625` s sum to
 * `0.25` s with no floating-point residue at all. At 60 Hz they do not, and a
 * check about the rest span would be reading the residue rather than the build.
 *
 * It is `STEP_SECONDS` alone, which is the LAST of a step's three spans. The
 * shatter and the fall run before it, so a step's whole hold is longer than this
 * by whatever `lastWaves` and `lastFall` were worth.
 */
export const FRAMES_PER_STEP = 16;

/**
 * Frames that carry `swapTimer` past `SWAP_SECONDS` and stop inside the step
 * that follows.
 *
 * 14 frames is `0.21875` s. `swapTimer` reaches `SWAP_SECONDS` (`0.18`) on the
 * twelfth frame, at `0.1875` s, so the swap is over whether the build compares
 * `>=` or `>` and step 1 has resolved. The `0.0075` s of overrun carries into
 * `stepTimer`, the two remaining frames add `0.03125` s, and the step is left
 * `0.03875` s into its hold.
 *
 * That is well short of `0.3` s, which is the SHORTEST hold any step can have:
 * `lastWaves` is `0` when the clear set is its seed alone, and `lastFall` is at
 * least `1` because a step that cleared anything refills at least one cell from
 * above row `0`, so the floor is `1 * FALL_SECONDS_PER_ROW + STEP_SECONDS`. So
 * exactly one step has resolved when this drive returns, on every board, and a
 * build that resolves a second inside it does not conform and is shown as an
 * extra chain step rather than hidden.
 */
export const SWAP_DRIVE_FRAMES = 14;

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
/* Where a cell is sampled — NOT a specification figure                       */
/* -------------------------------------------------------------------------- */
//
// One figure, and it grades nothing: it fixes the size of the box a pixel
// reading is cut from rather than anything that reading has to clear. Every
// check here that reads pixels reads PRESENCE — whether the build drew
// something where the specification says something is drawn — so no threshold
// stands beside it, and no check reads a hue, a contrast, an extent or a
// placement.

/**
 * Half the side of the pixel box a cell is read through.
 *
 * 20 gives a 41x41 box centered on the cell center: inside `GEM_R` (`30`), so it
 * lands on the gem rather than on whatever the board draws around it, and well
 * inside half of `CELL_PITCH` (`36`), so no neighbor's gem reaches into it.
 */
export const PATCH_HALF = 20;
