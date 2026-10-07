// effects/pierce-timer-falls-one-per-tick — the pierce timer falls by one on
// every tick the simulation advances.
//
// specs/pods.md, of the three timed effects: "each runs a whole-tick timer that
// starts at its duration and counts down by one on every tick the simulation
// advances". The posed countdown is exact because specs/instrumentation.md fixes
// `setEffectTicks` as leaving "the timer at exactly `ticks`", and specs/field.md's
// tick order runs "every running effect timer falls by one tick" as step 3 of
// every tick.
//
// THE WORLD IS THE TIMER AND NOTHING ELSE. The field is emptied and both driver
// switches are held, so no contact can end the effect early and only this kind's
// timer runs. That a CATCH starts a timer at the kind's full duration is
// `catch-starts-timer-at-duration`; each of the three kinds counts down on its
// own point, so a build that runs one timer and stalls another is told apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  close,
  open,
  record,
  setEffect,
  snap,
  ticks,
  world,
  type Harness,
} from "./pose";

/** A posed figure clear of both durations, so the read can only be the pose. */
const POSED = 120;

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("falls one per tick from the posed figure", async () => {
  await world(h);
  await setEffect(h, "pierce", POSED);
  assertEqual(
    (await snap(h)).effects.pierceTicks,
    POSED,
    "the posed timer, exactly",
  );

  const one = await record(h, "pierce-countdown", () => ticks(h, 1));
  assertEqual(one.effects.pierceTicks, POSED - 1, "one tick, one fall");

  const ten = await ticks(h, 9);
  assertEqual(
    ten.effects.pierceTicks,
    POSED - 10,
    "nine more ticks, nine more falls",
  );
});
