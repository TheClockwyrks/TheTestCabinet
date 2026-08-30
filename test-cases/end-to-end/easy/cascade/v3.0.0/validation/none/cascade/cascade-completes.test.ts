// cascade/cascade-completes — every card launches and every card retires.
//
// specs/victory.md: "The cascade is done once all fifty-two cards have launched
// and no card is in flight", and the launch order "skip[s] a foundation that has
// been emptied ... so the cascade launches all fifty-two cards". Three facts have
// to hold together at the end and this point reads all three, because they are
// one requirement: `launched` is `DECK_SIZE`, the flight is empty, and
// `cascadeDone` is set.
//
// NOTHING ABOUT THE ENDING IS POSED. The game is won through its own win path —
// fifty-one cards home and the last King sent to its foundation by a real move —
// and the cascade is then simply left to run itself out. A build whose launch
// order gets stuck on an emptied foundation never reaches fifty-two; one whose
// retirement test never fires keeps cards in flight forever; one that never sets
// its own end flag leaves the message unshown. All three fail here.
//
// THE WAIT IS OFF CAMERA AND THE END IS ON IT. The nine seconds of launching are
// covered by `skipUntil`, which runs the same real update without opening a
// recorded frame, and the recorder is armed only for the last cards leaving the
// table — which is what the replay is worth watching for and what keeps it inside
// the recorder's budget. The painting is off, per this group's rule, so the
// frames carry the flyers and no full-stage blit at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  framesFor,
} from "../harness";
import { CASCADE_RUNOUT_SECONDS, openCascade } from "./flight";

/**
 * How far the recorded stretch at the end may run, in frames.
 *
 * The last cards in the air have at most the width of the stage plus a card to
 * cover at `LAUNCH_VX_MIN`, which is under eight seconds; by the time the skip
 * has handed over there are at most two of them left. A bound on the sweep, not
 * a reading of it.
 */
const TAIL_FRAMES = framesFor(8);

/** Frames of the finished table recorded after it, so the replay ends on it. */
const SETTLE_FRAMES = framesFor(0.5);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("launches all fifty-two cards, retires them all, and marks itself done", async () => {
  await openCascade(harness);

  // The long middle of the cascade, run off camera at the same real update.
  await harness.skipUntil(
    (s) => s.cascadeDone || (s.launched >= DECK_SIZE && s.flyers.length <= 2),
    { maxSeconds: CASCADE_RUNOUT_SECONDS, pollSeconds: 0.25 },
  );

  const done = await captureReplay(harness, "cascade", async () => {
    const finished = await harness.until((s) => s.cascadeDone, {
      maxFrames: TAIL_FRAMES,
      poll: 2,
    });
    await harness.advance(SETTLE_FRAMES);
    return finished;
  });

  assertEqual(
    done.hit,
    true,
    `the cascade to be done within ${CASCADE_RUNOUT_SECONDS.toFixed(1)} s of the win`,
  );

  const end = await harness.snapshot();
  assertEqual(end.launched, DECK_SIZE, "cards the cascade launched");
  assertLength(end.flyers, 0, "cards left in flight once the cascade is done");
  assertEqual(end.cascadeDone, true, "the cascade's own end flag");
});
