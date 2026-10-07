// instrumentation/set-axis-rate-sets-the-signed-rate — `setAxisRate` sets an axis's
// signed rate.
//
// `specs/instrumentation.md` § The run in progress: "`setAxisRate(axis, rate)` — Sets
// an axis's signed rate", and "`setAxisRate` sets the rate the snapshot reports at
// once". The rate is SIGNED — `specs/program.md` gives each axis "its value, its
// signed rate" and drives it with a velocity that is negative whenever the axis is
// running back down its range — so a build that stored the magnitude, or clamped the
// pose to a positive number, reports the wrong direction of travel for every
// scenario that poses one.
//
// TWO AXES, ONE POSITIVE AND ONE NEGATIVE, and both fractional or large enough not to
// be confused with a default: `1.5` is not a whole number of units a second and `-20`
// is the same rule read in the other direction. Both are within the axis's own max
// rate (`TROLLEY_MAX_RATE` `4`, `SLEW_MAX_RATE` `30`), so nothing here asks whether
// the pose is bounded — that is the tape editor's rule, on a step's command.
//
// Neither axis carries a command: the run is read at the tick it started on, and
// nothing is advanced, so what the snapshot reports is what the pose wrote.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The two rates posed, one each way. */
const TROLLEY_RATE = 1.5;
const SLEW_RATE = -20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the signed rate posed onto an axis, negative rates included", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);

  await h.debug.setAxisRate("trolley", TROLLEY_RATE);
  const trolley = (await h.snapshot()).run.axes.trolley.rate;

  await h.debug.setAxisRate("slew", SLEW_RATE);
  const slew = (await h.snapshot()).run.axes.slew.rate;

  await h.capture("state", "the run carrying the two rates that were posed");

  assertEqual(
    trolley,
    TROLLEY_RATE,
    "the trolley's rate after setAxisRate (specs/instrumentation.md)",
  );
  assertEqual(
    slew,
    SLEW_RATE,
    "the slew's rate after setAxisRate: the sign is the rate's, and is kept",
  );
});
