// bays/fish-appears-in-open-bay — the bonus catch the cadence produces turns up
// in a bay that is OPEN.
//
// specs/bays.md: "A bonus catch is a small fish that visits the open bays ... The
// bay a bonus catch appears in is drawn at random when it appears, uniformly
// among the bays that are open at that moment other than the bay the previous
// bonus catch occupied."
//
// This is one of the five points whose requirement IS the cadence, so
// `setFishCadence` is turned back on after `startCrossing` shut it. Nothing else
// on the strait is touched: no fish is posed, because a posed one would be this
// check's own choice of bay rather than the build's.
//
// THE FILLED BAY IS BAY `0`, AND THE INDEX IS THE POINT OF IT. There is no
// previous bonus catch on a level's first, so the draw is over the four bays that
// remain open — and the wrong models this point exists to catch are the ones that
// draw over all five: taking the first bay of the array, taking `bays[0]`
// outright, or drawing an index without filtering. Every one of those reads `0`,
// which the check below refuses. Filling any other bay would leave the commonest
// wrong answer indistinguishable from a right one.
//
// What is read is the bay's own flag rather than its index, so a build that is
// merely drawing a different bay from the reference's still passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { FISH_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The one bay posed filled: the index every "ignores openness" model reads. */
const FILLED_BAY = 0;

/**
 * How long the first bonus catch is waited for, in seconds of game time.
 *
 * `specs/bays.md` has the first appear `FISH_INTERVAL` (`8` s) after the level is
 * laid out. Half as long again is allowed here, because WHEN it arrives is
 * `bays/fish-interval`'s requirement rather than this one's: a build whose first
 * catch is a second late should fail there and pass here.
 */
const WAIT_SECONDS = FISH_INTERVAL * 1.5;

/** How much game time separates two samples of the wait. */
const POLL_SECONDS = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the first bonus catch in a bay that is open", async () => {
  await startCrossing(h);
  await h.debug.setBay(FILLED_BAY, true);
  await h.debug.setFishCadence(true);

  const appeared = await h.skipUntil((s) => s.fishBay !== null, {
    maxSeconds: WAIT_SECONDS,
    pollSeconds: POLL_SECONDS,
  });

  await h.step();
  await captureStill(h, "fish");

  assertEqual(appeared.hit, true, "a bonus catch within the wait");
  const bay = appeared.snapshot.fishBay;
  assertNotNull(bay, "the bay the bonus catch appeared in");
  assertEqual(
    appeared.snapshot.bays[bay as number],
    false,
    `bay ${bay} open when the bonus catch appeared in it`,
  );
});
