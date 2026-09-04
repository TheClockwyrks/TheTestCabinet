// states/ended-round-banks-no-time — a round that has ended banks no time.
//
// specs/movement.md: "A tick that ends the round is the last tick of that round.
// Whatever elapsed time the update was carrying beyond it is spent rather than
// held back, so a round that has ended banks nothing: the next time the
// simulation is asked to advance, it advances from an empty accumulator."
//
// WHY THIS BUILDS ITS OWN CLOCK. The rule is only observable when the update that
// kills the snake was carrying more than the one tick that killed it. The
// harness's own clock hands the game an eighth of a tick per frame, so a death
// under it always lands exactly on a tick boundary with nothing left over and
// nothing to bank. A two-step sequence gives the check the two frames it needs
// and nothing else: the first is `OVERRUN_MS`, 5.6 ticks, of which the first tick
// resolves the death and four and a half ticks' worth is still in that update's
// hand at the moment it does; the second is a microsecond.
//
// WHY THE SECOND FRAME IS A MICROSECOND. It is far below `TICK_SECONDS`, so a
// build advancing from an empty accumulator can resolve no tick from it whatever
// its epsilon, and a build that held the overrun back resolves every tick that
// overrun was worth on this one frame. The reading therefore separates the two
// designs and nothing else: it is not a claim about how much time the resumed
// round may cover, only that it starts from empty.
//
// The round is ended for real rather than posed, because what this is about is
// the state an ENDING leaves the accumulator in, and a posed `gameover` leaves
// the accumulator wherever the pose found it.

import { afterEach, beforeEach, it } from "vitest";
import { SequenceClock } from "@test-cabinet/structured-2d";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_SECONDS } from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The frame the round dies on: 5.6 ticks of game time, in milliseconds. */
const OVERRUN_MS = TICK_SECONDS * 5.6 * 1000;

/** The frame after the resume, far below a tick however it is rounded. */
const RESUME_MS = 1e-3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({
    clock: new SequenceClock([OVERRUN_MS, RESUME_MS]),
  });
});

afterEach(() => {
  h?.dispose();
});

it("advances from an empty accumulator after a round has ended", async () => {
  arrangeApproach(h, WALL_CELL, { dir: "left" });

  // One frame carrying five and a half ticks past the tick that ends the round.
  await h.advance(1);
  const ended = h.snapshot();
  assertEqual(
    ended.screen,
    "gameover",
    "the screen the overrunning frame left",
  );

  const resumed = await captureReplay(h, "resumed", async () => {
    h.debug.setScreen("playing");
    await h.advance(1);
    return h.snapshot();
  });

  assertEqual(
    resumed.ticks,
    ended.ticks,
    `ticks resolved by ${RESUME_MS} ms of the resumed round`,
  );
  assertDeepEqual(
    resumed.snake,
    ended.snake,
    "the chain the resumed round left",
  );
});
