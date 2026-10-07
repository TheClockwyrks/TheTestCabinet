// Floe — instrumentation/bear-emergence-gate: `setBearEmergence` gates the run's
// own emergence of bears and nothing else.
//
// `specs/instrumentation.md` gives the gate exactly that scope: "The run's own
// emergence of bears: a slot filling when its conditions are met, the
// re-emergence after a bear is removed included. A bear already on the strait
// senses, routes, travels, is removed by traffic, and catches exactly as usual."
// Every gate is "on at a fresh start, is restored to on by `reset`, and is
// reported by `snapshot`". `specs/hunter.md` fixes the emergence the gate holds
// off: an empty slot "fills the moment both of its conditions hold", which for
// the first slot are `BEAR_EMERGE_ADVANCE` (`3`) rows advanced and
// `BEAR_EMERGE_DELAY` (`0.6` s) since the slot fell empty.
//
// WITHOUT IT ALMOST NOTHING IN THIS SUITE CAN BE POSED. `startCrossing` shuts
// this gate so that a bear does not emerge behind a critter three rows up and
// join a scenario that never asked for one — a scenario about a floe, about a
// lane, about a hop. That makes the gate load-bearing, and a gate the suite
// leans on has to be known to work before anything leaning on it means anything.
//
// THE CONDITIONS ARE MET BEFORE EITHER HALF RUNS, so the gate is the only thing
// standing between the run and a bear. `specs/hunter.md` measures the advance as
// `ROW_NEAR - bestRow`, which `specs/hopping.md` fixes, so `bestRow` is posed ten
// rows off the near shore — well past the three the first slot asks for. The
// critter itself is posed on the median shelf, which `specs/strait.md` makes
// solid ice carrying no lane, so it can stand there for the whole sixty seconds
// without the water or the traffic reaching it; nine rows advanced by its own
// row and ten by `bestRow`, so a build reading either is past the threshold.
//
// SO THE NEAR SHORE IS WATCHED FOR SIXTY SECONDS WITH THE GATE OFF, and then
// until a bear arrives with it on. Sixty seconds is the item's own figure and it
// is a hundred times `BEAR_EMERGE_DELAY`, so a build that ignores the gate has
// had every chance. One direction alone would be half the requirement: a build
// whose bears never emerge at all passes the first reading and fails the second,
// so the pair names which.
//
// THE WINDOW THE SECOND HALF ALLOWS IS DELIBERATELY LOOSE. The specification does
// not say whether a slot's delay clock runs while the gate is shut, so a build
// whose slot has been empty for a minute may fill it on the next tick and a build
// that starts the delay when the gate opens takes `BEAR_EMERGE_DELAY`; five
// seconds covers either reading many times over, and grades neither. How long a
// slot should take, and where the bear appears, are `hunter/emerges-after-advance`
// and `hunter/emerges-at-near-shore`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  ROW_MEDIAN,
  ROW_NEAR,
  START_COL,
} from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** How many rows the crossing is posed to have advanced: the item's figure. */
const ADVANCE_ROWS = 10;

/** The `bestRow` that many rows off the near shore is worth (specs/hunter.md). */
const POSED_BEST_ROW = ROW_NEAR - ADVANCE_ROWS;

/** The game time the near shore is watched with the gate off, in seconds. */
const OFF_SECONDS = 60;

/** How long the gate is given to fill the slot once it is opened, in seconds. */
const ON_SECONDS = 5;

/** How much game time separates two readings while the gate is open, in seconds. */
const POLL_SECONDS = 0.1;

/** The stretch of each half kept as recorded frames, in seconds. */
const GLIMPSE_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the hunt away with the gate off and lets one bear emerge with it on", async () => {
  // `startCrossing` leaves the gate off and the strait empty of bears, which is
  // the first half's arrangement exactly.
  await startCrossing(h);
  await h.debug.setCritterTile(START_COL, ROW_MEDIAN);
  await h.debug.setBestRow(POSED_BEST_ROW);

  const posed = await h.snapshot();
  assertEqual(
    posed.bearEmergence,
    false,
    "snapshot().bearEmergence after setBearEmergence(false), which every gate " +
      "reports (specs/instrumentation.md)",
  );
  assertEqual(
    posed.bears.length,
    0,
    "the bears on the strait before the watch below",
  );
  assertEqual(
    posed.critter.present,
    true,
    "the critter the slot's conditions are measured against (specs/hunter.md)",
  );
  assertGreaterThanOrEqual(
    ROW_NEAR - posed.critter.bestRow,
    BEAR_EMERGE_ADVANCE,
    `the rows this crossing has advanced, as ROW_NEAR - bestRow, against the ` +
      `BEAR_EMERGE_ADVANCE (${BEAR_EMERGE_ADVANCE}) the first slot asks for ` +
      `(specs/hunter.md) — the gate is meant to be the only thing keeping the ` +
      `hunt away`,
  );

  const watched = await captureReplay(h, "gate", async () => {
    // The wait is skipped off camera and only the tail of it is recorded, so the
    // replay opens on the empty near shore rather than on a minute of stillness.
    await h.skip(OFF_SECONDS - GLIMPSE_SECONDS);
    await h.advance(ticksFor(GLIMPSE_SECONDS));
    const off = await h.snapshot();

    await h.debug.setBearEmergence(true);
    const opened = await h.snapshot();
    const on = await h.until((snapshot) => snapshot.bears.length > 0, {
      maxTicks: ticksFor(ON_SECONDS),
      poll: ticksFor(POLL_SECONDS),
    });
    await h.advance(ticksFor(GLIMPSE_SECONDS));
    return { off, opened, on };
  });

  assertEqual(
    watched.off.bears.length,
    0,
    `the bears on the strait after ${OFF_SECONDS} s of a live crossing with ` +
      `setBearEmergence(false), the conditions of the first slot met ` +
      `throughout — the gate holds off a slot filling (specs/instrumentation.md)`,
  );
  assertEqual(
    watched.opened.bearEmergence,
    true,
    "snapshot().bearEmergence after setBearEmergence(true)",
  );
  assertTrue(
    watched.on.hit,
    `a bear on the strait within ${ON_SECONDS} s of setBearEmergence(true), ` +
      `which is over eight times the BEAR_EMERGE_DELAY (${BEAR_EMERGE_DELAY} s) ` +
      `the first slot waits (specs/hunter.md)`,
  );
  assertGreaterThanOrEqual(
    watched.on.snapshot.bears.length,
    1,
    "the bears the opened gate let onto the strait",
  );
});
