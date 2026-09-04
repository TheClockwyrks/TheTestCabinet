// bays/fish-moves-on — the catch that follows one that lingered out is in a
// DIFFERENT open bay.
//
// specs/bays.md: "The bay a bonus catch appears in is drawn from the game's own
// seeded randomness, among the bays that are open at that moment other than the
// bay the previous bonus catch occupied."
//
// A catch is posed into a bay with `setFishBay`, its linger is run out, and the
// bay the NEXT one takes is read. The posed catch is the previous bonus catch: it
// occupied that bay and it has left, which is exactly the condition the rule
// names.
//
// TWO BAYS ARE LEFT OPEN, AND THAT IS WHAT MAKES THE READING DECIDE ANYTHING.
// The wrong model this point exists to catch is the one that draws among the open
// bays without excluding the previous — and with all five open that model still
// lands somewhere else four times in five, so one reading of it is a coin toss
// dressed up as a verdict. With only the catch's own bay and one other open, the
// rule leaves a compliant build exactly one answer at every step, while the model
// that forgot the exclusion is choosing between two. It is then watched over
// `CYCLES` successive catches, so that model has to keep guessing right to
// survive.
//
// Nothing here is read off the reference: which bay a compliant build picks is
// forced by the rule rather than chosen by the build, and the checks below name
// only that the bay is open and that it is not the one the catch before it held.
//
// The other three bays are POSED filled, which clears no level
// (`bays/posed-full-does-not-clear`), and a catch is never taken by a fill here
// because the critter never leaves the near shore.
//
// Nothing is timed: `bays/fish-lingers` and `bays/fish-interval` own the two
// durations, and each sweep here is half again the figure it waits on so a build
// that got one wrong fails there rather than here. Because nothing here is timed,
// the whole minute and three quarters of game time runs at the harness's COARSE
// pace — the same ticks, one picture in ten — which is what `Harness.pace` is for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { BAY_COUNT, FISH_INTERVAL, FISH_LINGER } from "../constants";
import {
  COARSE_TICKS,
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The bay the first catch is posed into: the middle of the five. */
const BAY = 2;

/** The one other bay left open, so the exclusion has exactly one answer. */
const OTHER_BAY = 4;

/** The three bays posed filled, which is what leaves those two open. */
const FILLED_BAYS: number[] = Array.from(
  { length: BAY_COUNT },
  (_, index) => index,
).filter((index) => index !== BAY && index !== OTHER_BAY);

/**
 * How many successive catches are watched.
 *
 * A build that draws among the open bays without excluding the previous one
 * survives a single step half the time, this pose having left two bays open. Over
 * eight it survives once in two hundred and fifty-six, which is the difference
 * between a reading and a verdict. Each step costs `FISH_LINGER` plus
 * `FISH_INTERVAL` (`13` s) of game time.
 */
const CYCLES = 8;

/**
 * Half again as long as each figure, in COARSE frames, since neither duration is
 * what is graded here. `COARSE_TICKS` ticks run in each of these frames, so the
 * game time a sweep covers is the figure the constant names.
 */
const LINGER_WAIT_FRAMES = Math.ceil(
  ticksFor(FISH_LINGER * 1.5) / COARSE_TICKS,
);
const INTERVAL_WAIT_FRAMES = Math.ceil(
  ticksFor(FISH_INTERVAL * 1.5) / COARSE_TICKS,
);

/**
 * How many coarse frames separate two samples of a wait: one, which is
 * `COARSE_TICKS` ticks — a twelfth of a second at the `TICK_HZ` (`120`)
 * specs/overview.md fixes, and far finer than the five- and eight-second figures
 * the cadence is stated in.
 */
const POLL_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts each bonus catch in an open bay the one before it did not hold", async () => {
  startCrossing(h);
  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);
  h.debug.setFishCadence(true);
  h.debug.setFishBay(BAY);
  h.pace(COARSE_TICKS);

  let previous = BAY;
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    const gone = await h.until((s) => s.fishBay === null, {
      maxFrames: LINGER_WAIT_FRAMES,
      poll: POLL_FRAMES,
    });
    const next = await h.until((s) => s.fishBay !== null, {
      maxFrames: INTERVAL_WAIT_FRAMES,
      poll: POLL_FRAMES,
    });

    // The picture is of the first catch to follow the posed one, which is what
    // this point's output names. It is taken before any of the readings are
    // asserted, so a check that fails still leaves the strait it failed on.
    if (cycle === 1) captureStill(h, "fish");

    assertEqual(
      gone.hit,
      true,
      `the catch in bay ${previous} lingering out (specs/bays.md)`,
    );
    assertEqual(next.hit, true, `a catch following the one in bay ${previous}`);

    const bay = next.snapshot.fishBay;
    assertNotNull(bay, `the bay the catch after bay ${previous} took`);
    assertNotEqual(bay, previous, "the bay the previous bonus catch occupied");
    assertEqual(
      next.snapshot.bays[bay as number],
      false,
      `bay ${bay} open when the catch after bay ${previous} appeared in it`,
    );
    previous = bay as number;
  }
});
