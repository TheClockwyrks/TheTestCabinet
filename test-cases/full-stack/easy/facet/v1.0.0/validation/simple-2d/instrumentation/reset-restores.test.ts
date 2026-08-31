// Facet — instrumentation/reset-restores: `reset` puts every declared field back
// to its title-screen value, and `options.seed` is what seeds `rngState`.
//
// WHY THIS IS A POINT. specs/instrumentation.md writes `reset` out field by
// field — "the title screen with its first menu item highlighted, no board in
// play, `phase` `idle` with `chainStep` and `stepTimer` at `0`, `score` at `0`,
// `level` at `1`, `levelScore` at `0`, `lastCleared` and `lastPoints` at `0`,
// the cursor at `(0, 0)`, no selection and no refusal, the pointer reported as
// up, and `simTime` at `0`. `options.seed` seeds `rngState`, defaulting to
// `DEFAULT_SEED` (`1`)" — and specs/state.md says the same thing from the other
// side: "A `reset` restores the declared fields to their title-screen values, so
// those fields are the whole of the authoritative state." It is the operation
// every reproducible scenario in this project begins from: a `reset` that leaves
// one field of a spent round behind makes the next scenario start somewhere
// nobody wrote down, and the failure surfaces as a wrong number in an unrelated
// check rather than here.
//
// SO IT IS DRIVEN DIRTY FIRST. A reset read off a game that was already at rest
// asserts nothing: every field would be at its resting value whether `reset` ran
// or not. Every field the specification lists is therefore moved off that value
// first — a board posed and a chain running on it, a score, a level, a level
// score, a cursor, a selection, a refusal standing, a pressed pointer and a
// simulation clock that has ticked — and the arrangement is asserted to BE dirty
// before the reset is asked to undo it.
//
// WHAT THE DIRTY ARRANGEMENT PROVES, AND WHAT IT LEAVES ALONE. Every field this
// check POSES is read back before the reset, so a pose that did not take is
// reported as the fixture fault it is. `lastCleared` and `lastPoints` are not
// posed — nothing on the surface writes them, and they move only because a real
// step ran — and what they REPORT of that step is
// `scoring/last-step-reported`'s claim, not this point's. So no figure is
// required of them beforehand: a build whose `reset` is exact and whose reporting
// of a step is not would otherwise fail this point for the other one's fault.
// That a step really ran is carried by `chainStep` and the simulation clock, and
// the two fields are read where the specification names them — at `0`, after the
// reset.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. What a seed DEALS. That the same seed
// reproduces the same opening board is `instrumentation/seeded-determinism`;
// what is read here is the field the specification says the seed sets, and the
// default it says a bare `reset` carries.
//
// `muted` is not among the fields asserted: specs/instrumentation.md says
// "`muted` is untouched; the runtime owns muting", so a reset that changed it
// would be the defect.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotEqual,
  assertNotNull,
  assertLength,
  assertNull,
} from "../assert";
import { offBoardPoint, quietRowsWithEscape } from "../board";
import {
  CURSOR_START_COL,
  CURSOR_START_ROW,
  DEFAULT_SEED,
  GRID_COLS,
  GRID_ROWS,
} from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

let h: Harness;

/** A board carrying one productive swap, and a spare so the round lives on. */
const POSED = quietRowsWithEscape([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
]);

/** The swap that starts a chain on {@link POSED}: it completes a run of three. */
const SWAP = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

/** A swap R1 refuses outright, so a refusal is standing when the reset comes. */
const REFUSED = { a: { col: 0, row: 0 }, b: { col: 7, row: 7 } };

/** Values posed on the fields a round moves, none of them a resting value. */
const DIRTY = {
  score: 1234,
  level: 3,
  levelScore: 567,
  cursor: { col: 5, row: 6 },
};

/** A seed other than the default, for reading what `options.seed` does. */
const OTHER_SEED = DEFAULT_SEED + 1;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every declared field to its title-screen value", async () => {
  requireSurface();

  // A round, driven off every resting value the specification names.
  loadBoard(h, POSED);
  swap(h, SWAP.a, SWAP.b);
  // Frames, so the simulation clock and the step timer have both run.
  await h.advance(8);
  // R2 refuses a swap while a chain is resolving, so this leaves a refusal
  // standing whichever of R1 and R2 the build reads first.
  h.debug.requestSwap(
    REFUSED.a.col,
    REFUSED.a.row,
    REFUSED.b.col,
    REFUSED.b.row,
  );
  h.debug.setScore(DIRTY.score);
  h.debug.setLevel(DIRTY.level);
  h.debug.setLevelScore(DIRTY.levelScore);
  h.debug.setCursor(DIRTY.cursor.col, DIRTY.cursor.row);
  h.debug.setSelection(SWAP.a.col, SWAP.a.row);
  // Last, and with no frame after it: a press outside every cell's reach leaves
  // the board and the selection as they stand and puts the pointer down, and
  // `pointer` is refreshed from the runtime in every update.
  const away = offBoardPoint();
  h.debug.pointerDown(away.x, away.y);

  // The arrangement really is dirty. Without this the reset below could be
  // asserted against a game that had never left the title screen.
  const dirty = h.snapshot();
  assertEqual(dirty.screen, "playing", "the screen the round was driven on");
  assertLength(dirty.board.cells, GRID_COLS * GRID_ROWS, "the board in play");
  assertEqual(dirty.phase, "resolving", "the phase of the running chain");
  assertGreaterThan(dirty.chainStep, 0, "the chain step reached");
  assertGreaterThan(dirty.simTime, 0, "the simulation time accumulated");
  assertEqual(dirty.score, DIRTY.score, "the posed score");
  assertEqual(dirty.level, DIRTY.level, "the posed level");
  assertEqual(dirty.levelScore, DIRTY.levelScore, "the posed level score");
  assertDeepEqual(dirty.cursor, DIRTY.cursor, "the posed cursor");
  assertNotNull(dirty.selection, "the posed selection");
  assertNotNull(dirty.refusal, "the standing refusal");
  assertEqual(dirty.pointer.down, true, "the pressed pointer");

  h.debug.reset();
  const s = h.snapshot();

  // The screen and its menu.
  assertEqual(s.screen, "title", "the screen after reset");
  assertEqual(s.menuIndex, 0, "menuIndex after reset");

  // No board in play.
  assertEqual(s.board.cols, 0, "board.cols after reset");
  assertEqual(s.board.rows, 0, "board.rows after reset");
  assertDeepEqual(s.board.cells, [], "board.cells after reset");

  // Resolution, and the round's figures.
  assertEqual(s.phase, "idle", "phase after reset");
  assertEqual(s.chainStep, 0, "chainStep after reset");
  assertEqual(s.stepTimer, 0, "stepTimer after reset");
  assertEqual(s.score, 0, "score after reset");
  assertEqual(s.level, 1, "level after reset");
  assertEqual(s.levelScore, 0, "levelScore after reset");
  assertEqual(s.lastCleared, 0, "lastCleared after reset");
  assertEqual(s.lastPoints, 0, "lastPoints after reset");
  assertEqual(s.simTime, 0, "simTime after reset");

  // What the player was pointing at.
  assertDeepEqual(
    s.cursor,
    { col: CURSOR_START_COL, row: CURSOR_START_ROW },
    "the cursor after reset",
  );
  assertNull(s.selection, "selection after reset");
  assertNull(s.refusal, "refusal after reset");
  assertEqual(s.pointer.down, false, "the pointer after reset");

  // The still is taken after the reading, so nothing it needs advances the
  // clock the reading just held to zero.
  await h.advance(1);
  captureStill(h, "reset");
});

it("seeds rngState from options.seed, defaulting to DEFAULT_SEED", () => {
  requireSurface();

  // "`options.seed` seeds `rngState`, defaulting to `DEFAULT_SEED` (`1`)": a
  // bare reset and a reset carrying the default are the same reset, so the two
  // reach the same generator state.
  h.debug.reset({ seed: DEFAULT_SEED });
  const named = h.snapshot().rngState;
  h.debug.reset();
  const bare = h.snapshot().rngState;
  assertEqual(bare, named, "the rngState a bare reset reaches");

  // And the seed is really what set it: another seed reaches another state. A
  // build whose `reset` ignored the option would answer the same number here.
  h.debug.reset({ seed: OTHER_SEED });
  const other = h.snapshot().rngState;
  assertNotEqual(
    other,
    named,
    `the rngState reset({ seed: ${OTHER_SEED} }) reaches`,
  );
});
