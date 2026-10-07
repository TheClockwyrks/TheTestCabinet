// instrumentation/launch-clock-reads-back — the seconds `setLaunchClock` poses
// are the seconds `snapshot().launchClock` reports.
//
// THE RULE. `specs/instrumentation.md`, The cascade: `setLaunchClock(seconds)`
// "Sets the seconds accumulated toward the next launch", and the snapshot carries
// `launchClock` as exactly that.
//
// WHY IT IS A `broken` POINT. It is how a check reaches the moment BEFORE a
// launch without running the seconds that precede it — `cascade/launch-cadence`
// and `winning/*` both stand on it — so a build whose clock does not read back
// leaves those checks measuring a cascade that started somewhere else in its own
// cycle.
//
// THE POSED VALUE IS NEITHER ZERO NOR `LAUNCH_INTERVAL`, so a build that ignores
// the pose reads back the `0` `reset` left, and one that clamps to the interval
// reads back `0.18`; both are different numbers from the one posed.
//
// READ WITH NO FRAME BETWEEN THE POSE AND THE READING, because a frame carries
// the clock past the value it was just set to (`specs/victory.md`).
//
// WHAT THIS DOES NOT DECIDE. The cadence the clock produces, which is
// `cascade/launch-cadence`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** The launch clock posed, which is neither the `0` `reset` left nor the interval. */
const LAUNCH_CLOCK = 0.11;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the posed launch clock back through snapshot", async () => {
  openTable(h);

  h.debug.setLaunchClock(LAUNCH_CLOCK);
  // Read before a frame runs: a frame carries the clock past the value it was
  // just set to (`specs/victory.md`).
  const posed = h.snapshot();

  await h.advance(1);
  captureStill(h, "posed");

  assertEqual(
    posed.launchClock,
    LAUNCH_CLOCK,
    `snapshot().launchClock, in seconds, after setLaunchClock(${LAUNCH_CLOCK}) ` +
      `(specs/instrumentation.md)`,
  );
});
