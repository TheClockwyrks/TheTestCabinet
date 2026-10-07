// channel/catchup-advance — a segment that is not the lead segment closes at the
// fixed catch-up rate.
//
// THE SPEC LINE. `specs/channel.md`, "Advance": "Every other segment | `180`
// units/s", and below the table, "the catch-up rate of `180` units/s is fixed,
// and pressure and machinery leave it alone". The same section states how it is
// applied: "Each tick a segment's rate times the tick's elapsed time is added to
// the arc position of every core in it".
//
// THE DRIVE. Two lone cores a thousand units apart. "A **segment** is a maximal
// run of consecutive cores in the train whose arc positions differ by exactly
// `SPACING`", so a gap of a thousand makes two segments of one; the core at
// 2000 holds the head and is therefore the lead segment, and the core at 1000 is
// "every other segment". Thirty ticks is half a second, over which the trailing
// core gains 90 units and the lead one 11, so the gap is still 921 at the end
// and no merge can enter the reading. The two carry different charges, so
// nothing the drive does could extract; the inlet is held, so it places nothing
// behind them.
//
// THE TOLERANCE. `CATCHUP_ARC_TOL`, the +/- 1 unit the review item states for
// itself ("confirm the trailing core stands at 1090 (+/- 1)") in place of the
// standing +/- 2% for a speed. The point is entitled to the tighter bound and
// the arithmetic earns it: 30 ticks of a FIXED 180 units/s is exactly 90 units
// however a build accumulates it, so a conformant build lands on 1090 to
// floating-point noise, and the nearest wrong rule — a trailing segment riding
// at the lead's feed speed — is 79 units short.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CATCHUP_ARC_TOL, CATCHUP_SPEED } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  seconds,
  tail,
  type Harness,
} from "../harness";

/** The lead core, far enough ahead that the trailing one cannot reach it. */
const LEAD_S = 2000;

/** The trailing core, a segment of its own. */
const TRAIL_S = 1000;

/** Half a second of simulated time: the minimum span a speed is read over. */
const TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes a trailing segment at 180 units of arc per second", async () => {
  await poseHall(h, {
    cores: [
      [LEAD_S, "halide", null],
      [TRAIL_S, "sulfur", null],
    ],
  });
  const before = tail(await h.snapshot()).s;

  const after = await captureReplay(h, "catchup", () => h.step(TICKS));

  assertEqual(coreCount(after), 2, "the cores on the channel after the drive");
  assertNear(
    tail(after).s,
    before + CATCHUP_SPEED * seconds(TICKS),
    CATCHUP_ARC_TOL,
    "the trailing segment's arc position after 30 ticks of catching up",
  );
});
