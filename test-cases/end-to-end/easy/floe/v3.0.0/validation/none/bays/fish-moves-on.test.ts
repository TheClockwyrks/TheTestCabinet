// bays/fish-moves-on — the catch that follows one that lingered out is in a
// DIFFERENT open bay.
//
// specs/bays.md: "The bay a bonus catch appears in is drawn at random when it
// appears, uniformly among the bays that are open at that moment other than the
// bay the previous bonus catch occupied."
//
// A catch is posed into a bay with `setFishBay`, its linger is run out, and the
// bay the NEXT one takes is read. The posed catch is the previous bonus catch:
// it occupied that bay and it has left, which is exactly the condition the rule
// names.
//
// Every bay is open, so the exclusion is the only thing that can keep the next
// catch out of `BAY`. The draw is over the other four, and which of them the
// build's randomness picks is its own business — the check reads only that the
// bay is not `BAY` and that it is open, so a build drawing differently from any
// other still passes.
//
// The middle bay is used, so a build that always moves the catch one bay along
// its array, in either direction, lands somewhere the check accepts, and a build
// that never moves it lands where the check refuses. Nothing is timed here:
// `bays/fish-lingers` and `bays/fish-interval` own the two durations, and this
// point only waits long enough for both to pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { FISH_INTERVAL, FISH_LINGER } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The bay the first catch is posed into: the middle of the five. */
const BAY = 2;

/** Half again as long as each figure, since neither duration is what is graded here. */
const LINGER_WAIT = FISH_LINGER * 1.5;
const INTERVAL_WAIT = FISH_INTERVAL * 1.5;

/** How much game time separates two samples of a wait. */
const POLL_SECONDS = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the next bonus catch in another open bay", async () => {
  await startCrossing(h);
  await h.debug.setFishCadence(true);
  await h.debug.setFishBay(BAY);

  const gone = await h.skipUntil((s) => s.fishBay === null, {
    maxSeconds: LINGER_WAIT,
    pollSeconds: POLL_SECONDS,
  });
  assertEqual(gone.hit, true, "the posed catch lingering out (specs/bays.md)");

  const next = await h.skipUntil((s) => s.fishBay !== null, {
    maxSeconds: INTERVAL_WAIT,
    pollSeconds: POLL_SECONDS,
  });

  await h.step();
  await captureStill(h, "fish");

  assertEqual(next.hit, true, "a following bonus catch");
  const bay = next.snapshot.fishBay;
  assertNotNull(bay, "the bay the following bonus catch took");
  assertNotEqual(bay, BAY, "the bay the previous bonus catch occupied");
  assertEqual(
    next.snapshot.bays[bay as number],
    false,
    `bay ${bay} open when the following bonus catch appeared in it`,
  );
});
