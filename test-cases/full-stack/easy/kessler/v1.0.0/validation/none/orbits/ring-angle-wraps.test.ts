// orbits/ring-angle-wraps — a ring angle crossing 360, or 0, wraps modulo 360.
//
// specs/rings.md: "Ring angles wrap modulo `360`." Ring 2 is posed at 355 and
// carried +12 by a second of wave-1 ticks, so an unbounded build would report
// 367 where a wrapping one reports 7; ring 3 is posed at 5 and carried -8, so
// an unbounded build would report -3 where a wrapping one reports 357. Both
// readings also pin the reported figure inside [0, 360) — the range the wrap
// leaves an angle in. Tolerance is the same float-accumulation allowance the
// formula checks use.
//
// THE WORLD IS THE RINGS ALONE. No targets, balls, or pods — an orbit is the
// ring's own angle.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { ringAngle } from "./rings";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps past 360: 355 plus a wave-1 second reads 7", async () => {
  await isolate(h);
  await h.debug.setRingAngle(2, 355);

  const after = await captureReplay(h, "wrap-up", () => h.tick(60));

  const angle = ringAngle(after, 2);
  assertGreaterThanOrEqual(angle, 0, "the wrapped angle's floor");
  assertLessThan(angle, 360, "the wrapped angle's ceiling");
  assertCloseTo(angle, 7, 2, "ring 2's angle after advancing across 360");
});

it("wraps below 0: 5 minus a wave-1 second reads 357", async () => {
  await isolate(h);
  await h.debug.setRingAngle(3, 5);

  const after = await captureReplay(h, "wrap-down", () => h.tick(60));

  const angle = ringAngle(after, 3);
  assertGreaterThanOrEqual(angle, 0, "the wrapped angle's floor");
  assertLessThan(angle, 360, "the wrapped angle's ceiling");
  assertCloseTo(angle, 357, 2, "ring 3's angle after falling across 0");
});
