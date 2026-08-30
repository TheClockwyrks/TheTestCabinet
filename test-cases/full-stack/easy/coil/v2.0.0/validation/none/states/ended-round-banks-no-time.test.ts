// states/ended-round-banks-no-time — a round that has ended banks no time.
//
// specs/movement.md: "A tick that ends the round is the last tick of that round.
// Whatever elapsed time the update was carrying beyond it is spent rather than
// held back, so a round that has ended banks nothing: the next time the
// simulation is asked to advance, it advances from an empty accumulator."
//
// WHY ONE ENORMOUS UPDATE. The rule is only observable when the update that kills
// the snake was carrying more than the one tick that killed it. The harness's own
// clock hands the game an eighth of a tick per frame, so a death under it always
// lands exactly on a tick boundary with nothing left over and nothing to bank.
// One update of `OVERRUN_SECONDS` is 5.6 ticks: the first resolves the death and
// four and a half ticks' worth is still in the update's hand at that moment.
//
// WHY THE SECOND UPDATE IS A MICROSECOND. It is far below `TICK_SECONDS`, so a
// build advancing from an empty accumulator can resolve no tick from it whatever
// its epsilon, and a build that held the overrun back resolves every tick that
// overrun was worth on this one update. The reading therefore separates the two
// designs and nothing else: it is not a claim about how much time the resumed
// round may cover, only that it starts from empty.
//
// The round is ended for real rather than posed, because what this is about is
// the state an ENDING leaves the accumulator in, and a posed `gameover` leaves
// the accumulator wherever the pose found it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_SECONDS } from "../constants";
import { deliver } from "../movement/updates";
import {
  WALL_CELL,
  arrangeApproach,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The one update the round dies on: 5.6 ticks of game time, in seconds. */
const OVERRUN_SECONDS = TICK_SECONDS * 5.6;

/** The one update after the resume, far below a tick however it is rounded. */
const RESUME_SECONDS = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances from an empty accumulator after a round has ended", async () => {
  await arrangeApproach(h, WALL_CELL, { dir: "left" });

  // One update carrying five and a half ticks past the tick that ends the round.
  await deliver(h, OVERRUN_SECONDS, 1);
  const ended = await h.snapshot();
  assertEqual(ended.screen, "gameover", "the screen the overrunning update left");

  const resumed = await captureReplay(h, "resumed", async () => {
    await h.debug.setScreen("playing");
    await deliver(h, RESUME_SECONDS, 1);
    return h.snapshot();
  });

  assertEqual(
    resumed.ticks,
    ended.ticks,
    `ticks resolved by ${RESUME_SECONDS} s of the resumed round`,
  );
  assertDeepEqual(resumed.snake, ended.snake, "the chain the resumed round left");
});
