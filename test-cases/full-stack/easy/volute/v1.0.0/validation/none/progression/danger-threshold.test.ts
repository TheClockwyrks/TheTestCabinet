// progression/danger-threshold — the hall reads as in danger near the intake.
//
// THE SPEC LINE. `specs/progression.md` — "Danger": "The run is in danger while
// the head's `s` is at least 4000. The condition is evaluated every tick and
// holds only while a head exists". `DANGER_S` is that 4000, and
// `specs/instrumentation.md` reports the answer as the snapshot's `danger`, one
// of the seven fields it derives rather than stores: "danger | The head's arc
// position against the danger threshold."
//
// THE DRIVE. The threshold has two sides and they are one requirement, so one
// suite poses both: a lone core 10 units below 4000, which must read false, and
// the same hall with it 10 units above, which must read true. Nothing else stands
// on the channel, so the head whose arc position decides the answer is the core
// this point posed.
//
// WHY A TICK IS STEPPED BEFORE EACH READING. The specification derives `danger`,
// so a snapshot taken straight after the pose would already answer; but a build
// that recomputes it once per tick, which the same file's "evaluated every tick"
// allows for, answers on the tick after. One tick is stepped so both designs are
// read at the point the spec fixes the value, and it carries the core a third of
// a unit, which is a thirtieth of the margin either pose stands off the
// threshold.
//
// TOLERANCES. None on the answer, which is a boolean. The 10-unit margin either
// side of 4000 is the tolerance that matters, and it is set by what a build may
// legally do to the core between the pose and the reading: one tick at level 1's
// feed speed is 0.37 units, so 10 units leaves a build 27 ticks of slack before
// either pose could cross the line it is testing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DANGER_S } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** How far either pose stands off the threshold, in arc units. */
const MARGIN = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads danger only once the head has reached 4000", async () => {
  await poseHall(h, {
    level: 1,
    quotaRemaining: 0,
    pressure: 0,
    cores: [[DANGER_S - MARGIN, "halide", null]],
  });
  const below = await h.step(1);

  await poseHall(h, {
    level: 1,
    quotaRemaining: 0,
    pressure: 0,
    cores: [[DANGER_S + MARGIN, "halide", null]],
  });
  const above = await h.step(1);
  await captureStill(h, "danger");

  assertEqual(
    below.danger,
    false,
    `the danger flag with the head ${MARGIN} units below ${DANGER_S}`,
  );
  assertEqual(
    above.danger,
    true,
    `the danger flag with the head ${MARGIN} units above ${DANGER_S}`,
  );
});
