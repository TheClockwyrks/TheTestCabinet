// Facet — instrumentation/reset-restores-every-field: `reset` puts every
// declared field back to its title-screen value.
//
// WHY THIS IS A POINT. specs/instrumentation.md writes `reset` out field by
// field — "the title screen with its first menu item highlighted, no board in
// play, `phase` `idle` with `chainStep`, `swapTimer` and `stepTimer` at `0`,
// `score` at `0`, `level` at `1`, `levelScore` at `0`, `lastCleared`,
// `lastPoints` and `lastWaves` at `0`, `moveScore`, `bestMove` and `bestChain`
// at `0`, no selection, no offer, no refusal and no armed target, the pointer
// reported as up and driven by `mouse`, and `simTime` at `0`" — and
// specs/state.md says the same thing from the other side: "A `reset` restores
// the declared fields to their title-screen values, so those fields are the
// whole of the authoritative state." It is the operation every reproducible
// scenario in this project begins from: a `reset` that leaves one field of a
// spent round behind makes the next scenario start somewhere nobody wrote down,
// and the failure surfaces as a wrong number in an unrelated check rather than
// here.
//
// WHAT IT DOES NOT DECIDE. That `options.seed` is what seeds `rngState` is
// `instrumentation/reset-seeds-the-rng`. A build whose reset restores every
// field and ignores the seed passes this point and fails that one, which is the
// separation two points buy.
//
// SO IT IS DRIVEN DIRTY FIRST. A reset read off a game that was already at rest
// asserts nothing: every field would be at its resting value whether `reset` ran
// or not. Every field the specification lists is therefore moved off that value
// first — a board posed, a swap accepted and carried past its own animation into
// a scoring chain, a score, a level, a level score, a best move, a selection and
// an offer standing, a refusal raised, a touch press holding a target armed, and
// a simulation clock that has ticked — and the arrangement is asserted to BE
// dirty before the reset is asked to undo it.
//
// WHY THE SWAP IS CARRIED PAST ITS ANIMATION. specs/rules.md has an accepted
// swap enter `swapping` and clear nothing for `SWAP_SECONDS` (`0.18`) of game
// time, so a request alone leaves `chainStep` at `0` and `moveScore` at nothing.
// It is the step the animation opens onto that scores, raises `bestChain` and
// starts `stepTimer`, so the drive is what makes those three fields dirty at all.
//
// WHAT THE DIRTY ARRANGEMENT PROVES, AND WHAT IT LEAVES ALONE. Every field this
// check POSES is read back before the reset, so a pose that did not take is
// reported as the fixture fault it is. `lastCleared`, `lastPoints` and
// `lastWaves` are not posed — nothing on the surface writes them, and they move
// only because a real step ran — and what they REPORT of a step is
// `scoring/last-step-reported`'s and `expansion`'s claim, not this point's. So no
// figure is required of them beforehand: a build whose `reset` is exact and whose
// reporting of a step is not would otherwise fail this point for the other one's
// fault. That a step really ran is carried by `chainStep` and the simulation
// clock, and the three fields are read where the specification names them — at
// `0`, after the reset.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertLength,
  assertNull,
} from "../assert";
import { quietRowsWithEscape } from "../board";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  pressTarget,
  swapAndStep,
  targetById,
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

/** The cell selected, and the neighbor it is offered into, when the reset comes. */
const HELD = { col: 6, row: 6 };
const OFFERED = { col: 6, row: 7 };

/** Values posed on the fields a round moves, none of them a resting value. */
const DIRTY = {
  score: 1234,
  level: 3,
  levelScore: 567,
  bestMove: 890,
};

/**
 * The one target the `playing` screen carries, from specs/controls.md.
 *
 * A press inside it arms it and takes nothing, so the armed target the reset has
 * to clear is standing without the screen having changed under the arrangement.
 */
const PLAYING_TARGET = "pause";

/**
 * The device the press is made with.
 *
 * `reset` restores the pointer to "up and driven by `mouse`", and `mouse` is
 * what the specification's own default supplies, so a press posed as a mouse
 * would leave the device already at the value the reset is asked to restore.
 * A touch press is what gives that half of the sentence something to undo.
 */
const PRESS_DEVICE = "touch";

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores every declared field to its title-screen value", async () => {
  requireSurface();

  // A round, driven off every resting value the specification names. The swap is
  // carried through its own animation, so the chain has really resolved a step
  // and the simulation clock and the step timer have both run.
  await loadBoard(h, POSED);
  await swapAndStep(h, SWAP.a, SWAP.b);
  // R2 refuses a swap while a chain is resolving, so this leaves a refusal
  // standing whichever of R1 and R2 the build reads first.
  await h.debug.requestSwap(
    REFUSED.a.col,
    REFUSED.a.row,
    REFUSED.b.col,
    REFUSED.b.row,
  );
  await h.debug.setScore(DIRTY.score);
  await h.debug.setLevel(DIRTY.level);
  await h.debug.setLevelScore(DIRTY.levelScore);
  await h.debug.setBestMove(DIRTY.bestMove);
  await h.debug.setSelection(HELD.col, HELD.row);
  await h.debug.setOffer(OFFERED.col, OFFERED.row);
  // Last, and with no frame after it: specs/controls.md says a press within a
  // target "is armed" and takes nothing until the release, and a press inside the
  // `pause` target is not a press on the board, so the selection and the offer
  // posed above stand through it.
  await pressTarget(
    h,
    targetById(await h.snapshot(), PLAYING_TARGET),
    PRESS_DEVICE,
  );

  // The arrangement really is dirty. Without this the reset below could be
  // asserted against a game that had never left the title screen.
  const dirty = await h.snapshot();
  assertEqual(dirty.screen, "playing", "the screen the round was driven on");
  assertLength(dirty.board.cells, GRID_COLS * GRID_ROWS, "the board in play");
  assertEqual(dirty.phase, "resolving", "the phase of the running chain");
  assertGreaterThan(dirty.chainStep, 0, "the chain step reached");
  assertGreaterThan(dirty.stepTimer, 0, "the step timer of the running step");
  assertGreaterThan(dirty.simTime, 0, "the simulation time accumulated");
  assertGreaterThan(dirty.moveScore, 0, "the points the move has scored");
  assertGreaterThan(dirty.bestChain, 0, "the deepest chain step reached");
  assertEqual(dirty.score, DIRTY.score, "the posed score");
  assertEqual(dirty.level, DIRTY.level, "the posed level");
  assertEqual(dirty.levelScore, DIRTY.levelScore, "the posed level score");
  assertEqual(dirty.bestMove, DIRTY.bestMove, "the posed best move");
  assertNotNull(dirty.selection, "the posed selection");
  assertNotNull(dirty.offer, "the posed offer");
  assertNotNull(dirty.refusal, "the standing refusal");
  assertNotNull(dirty.armedTarget, "the target the press armed");
  assertEqual(dirty.pointer.down, true, "the pressed pointer");
  assertEqual(dirty.pointer.device, PRESS_DEVICE, "the device that pressed");

  await h.debug.reset();
  const s = await h.snapshot();

  // The screen and its menu.
  assertEqual(s.screen, "title", "the screen after reset");
  assertEqual(s.menuIndex, 0, "menuIndex after reset");

  // No board in play.
  assertEqual(s.board.cols, 0, "board.cols after reset");
  assertEqual(s.board.rows, 0, "board.rows after reset");
  assertDeepEqual(s.board.cells, [], "board.cells after reset");

  // Resolution, and the three timers a move in motion runs off.
  assertEqual(s.phase, "idle", "phase after reset");
  assertEqual(s.chainStep, 0, "chainStep after reset");
  assertEqual(s.swapTimer, 0, "swapTimer after reset");
  assertEqual(s.stepTimer, 0, "stepTimer after reset");

  // The round's figures, and the three a level is measured by.
  assertEqual(s.score, 0, "score after reset");
  assertEqual(s.level, 1, "level after reset");
  assertEqual(s.levelScore, 0, "levelScore after reset");
  assertEqual(s.lastCleared, 0, "lastCleared after reset");
  assertEqual(s.lastPoints, 0, "lastPoints after reset");
  assertEqual(s.lastWaves, 0, "lastWaves after reset");
  assertEqual(s.moveScore, 0, "moveScore after reset");
  assertEqual(s.bestMove, 0, "bestMove after reset");
  assertEqual(s.bestChain, 0, "bestChain after reset");
  assertEqual(s.simTime, 0, "simTime after reset");

  // What the player had hold of, and what the pointer was doing.
  assertNull(s.selection, "selection after reset");
  assertNull(s.offer, "offer after reset");
  assertNull(s.refusal, "refusal after reset");
  assertNull(s.armedTarget, "armedTarget after reset");
  assertEqual(s.pointer.down, false, "the pointer after reset");
  assertEqual(s.pointer.device, "mouse", "the pointer's device after reset");

  // The still is taken after the reading, so nothing it needs advances the
  // clock the reading just held to zero.
  await h.advance(1);
  await captureStill(h, "reset");
});
