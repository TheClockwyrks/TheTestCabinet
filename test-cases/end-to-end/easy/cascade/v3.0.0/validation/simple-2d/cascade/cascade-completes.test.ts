// cascade/cascade-completes — every card launches, and every card retires.
//
// specs/victory.md: "the cascade launches all fifty-two cards", and "the cascade is
// done once all fifty-two cards have launched and no card is in flight". A cascade
// that stalls with cards still on the foundations, or with a card that never leaves
// the table, never reaches its end and the won screen never settles, which is why
// this point is the one in the group that a build cannot be half right about.
//
// ALL THREE READINGS ARE THE ONE REQUIREMENT: the cascade ran out. `launched` is the
// counter the cascade raises as it goes, the flight is what is left on the table, and
// `cascadeDone` is the build's own end test. A build that launches fifty-two cards and
// never notices it has finished has not finished.
//
// It is driven through the game's own win path, and it is driven to the end rather
// than to a fixed span: the last card leaves the foundations about nine seconds in
// and then has to cross the table, and how long that takes depends on the horizontal
// speed the generator drew for it. Twenty seconds is past the slowest draw the range
// allows.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  startCascade,
  type Harness,
} from "../harness";

/**
 * How long the cascade is given to run out, in frames.
 *
 * The fifty-second launch falls fifty-one launch intervals in, a little over nine
 * seconds; the slowest launch the range allows then needs under four more to cross
 * the table from the farthest foundation. Twenty seconds is comfortably past both and
 * short enough that a build that never finishes is reported rather than left running.
 */
const MAX_FRAMES = framesFor(20);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("runs the cascade out to its end", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const snapshot = await captureReplay(harness, "cascade", async () => {
    const run = await harness.until((seen) => seen.cascadeDone, {
      maxFrames: MAX_FRAMES,
    });
    return run.snapshot;
  });

  assertEqual(
    snapshot.launched,
    DECK_SIZE,
    "the cards the cascade launched by the time it was done",
  );
  assertLength(
    snapshot.flyers,
    0,
    "the cards still in flight when the cascade was done",
  );
  assertEqual(
    snapshot.cascadeDone,
    true,
    "the cascade's own end flag, once every card has launched and retired",
  );
});
