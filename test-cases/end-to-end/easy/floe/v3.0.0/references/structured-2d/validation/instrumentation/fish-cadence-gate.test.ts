// instrumentation/fish-cadence-gate — `setFishCadence` gates the bonus catch's own
// cadence and nothing else.
//
// specs/instrumentation.md gives the gate exactly that scope: "The bonus catch's
// own cadence: one appearing in an open bay, lingering, and moving on. A bonus
// catch posed through the surface still scores when its bay is filled." Every gate
// is "on at a fresh start, is restored to on by `reset`, and is reported by
// `snapshot`". specs/bays.md fixes the cadence the gate holds off: a level "opens
// with no bonus catch out", the first appears `FISH_INTERVAL` (`8` s) after the
// level is laid out, each lingers `FISH_LINGER` (`5` s), and the next arrives
// `FISH_INTERVAL` after the previous one leaves.
//
// WITHOUT IT NO CHECK CAN READ A BAY AND TRUST WHAT IT FOUND. `startCrossing`
// shuts this gate so that a bonus catch does not arrive on its own eight-second
// cadence into a bay some other scenario is in the middle of reading, and so that
// the checks that pose a catch through the surface are reading the one they posed.
// That makes the gate load-bearing, and a gate the suite leans on has to be known
// to work before anything leaning on it means anything.
//
// SO THE BAYS ARE WATCHED THROUGH SIXTY SECONDS OF A LIVE CROSSING WITH THE GATE
// OFF, and then through one cadence with it on. Sixty seconds is the item's own
// figure and it is more than seven whole `FISH_INTERVAL` periods, so a build that
// ignores the gate has had seven chances to put a catch out. THE WATCH IS A SWEEP
// RATHER THAN ONE READING AT THE END: a catch lingers `FISH_LINGER` (`5` s) and
// then moves on, so a build that put several out over the minute could have none
// out at the moment a single final reading was taken. The sweep looks every half
// second, which is a tenth of the shortest time one is out for.
//
// ONE DIRECTION ALONE WOULD BE HALF THE REQUIREMENT: a build whose bonus catch
// never appears at all passes the first reading and fails the second, so the pair
// names which.
//
// THE FIVE BAYS ARE LEFT OPEN, which `startCrossing` does, because specs/bays.md
// draws the bay from "the bays that are open at that moment" and says that "Where
// no such bay exists, none appears". A catch that stayed away from a far shore
// with nowhere to go would say nothing about the gate.
//
// THE WINDOW THE SECOND HALF ALLOWS IS TWO WHOLE CADENCE CYCLES. The specification
// does not say where in its cycle the cadence resumes when the gate is opened, so
// a build whose clock kept running under the gate may put a catch out at once and
// a build whose clock restarts takes `FISH_INTERVAL`; twice
// `FISH_INTERVAL + FISH_LINGER` covers either reading with a cycle to spare, and
// grades neither.

import { afterEach, beforeEach, it } from "vitest";
import { BAY_COUNT, FISH_INTERVAL, FISH_LINGER } from "../constants";
import { assertBetween, assertEqual, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The game time the bays are watched with the gate off, in seconds. */
const OFF_SECONDS = 60;

/** How long the gate is given to put a catch out, in seconds: two whole cycles. */
const ON_SECONDS = 2 * (FISH_INTERVAL + FISH_LINGER);

/** How much game time separates two readings of the bays, in seconds. */
const POLL_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the bonus catch away with the gate off and lets one arrive with it on", async () => {
  // `startCrossing` leaves the gate off, the five bays open and no catch out,
  // which is the first half's arrangement exactly.
  startCrossing(h);

  const posed = h.snapshot();
  assertEqual(
    posed.fishCadence,
    false,
    "snapshot().fishCadence after setFishCadence(false), which every gate " +
      "reports (specs/instrumentation.md)",
  );
  assertNull(posed.fishBay, "the bonus catch a fresh level opens with");
  assertEqual(
    posed.bays.filter(Boolean).length,
    0,
    "the filled bays under the watch below — specs/bays.md draws the catch's " +
      "bay from the OPEN ones, so a far shore with nowhere to put one would say " +
      "nothing about the gate",
  );

  const off = await h.skipUntil((snapshot) => snapshot.fishBay !== null, {
    maxSeconds: OFF_SECONDS,
    pollSeconds: POLL_SECONDS,
  });

  h.debug.setFishCadence(true);
  const opened = h.snapshot();
  const on = await h.skipUntil((snapshot) => snapshot.fishBay !== null, {
    maxSeconds: ON_SECONDS,
    pollSeconds: POLL_SECONDS,
  });
  await h.advance(1);
  // Before the assertions, so a failing cadence still leaves the picture of the
  // far shore it was read on.
  captureStill(h, "gate");

  assertNull(
    off.snapshot.fishBay,
    `the bay holding a bonus catch at any point in ${OFF_SECONDS} s of a live ` +
      `crossing with setFishCadence(false), which is over ` +
      `${Math.floor(OFF_SECONDS / FISH_INTERVAL)} whole FISH_INTERVAL periods ` +
      `(specs/bays.md)`,
  );

  assertEqual(
    opened.fishCadence,
    true,
    "snapshot().fishCadence after setFishCadence(true)",
  );
  assertTrue(
    on.hit,
    `a bonus catch out within ${ON_SECONDS} s of setFishCadence(true), which is ` +
      `two whole cadence cycles of FISH_INTERVAL (${FISH_INTERVAL} s) plus ` +
      `FISH_LINGER (${FISH_LINGER} s) (specs/bays.md)`,
  );
  assertBetween(
    on.snapshot.fishBay ?? Number.NaN,
    0,
    BAY_COUNT - 1,
    "the bay the arrived bonus catch is in, of the five specs/strait.md fixes",
  );
});
