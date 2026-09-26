// collision/freeze-at-first-sample — the samples are evaluated in order, so a
// faulting run freezes at the FIRST sample within `38` even when a later one is
// nearer.
//
// THE RULE. "Within the motion step, every mote's position is evaluated at the
// sample fractions `t = k / 8` for `k` from `1` to `8`, in order. If at any sample
// the distance between the centers of two motes is strictly less than
// `2 * MOTE_COLLIDE_R` (`38`), the run faults as `collision` at that sample" —
// and, stated on its own beneath the worked examples, "A faulting run freezes at
// the first sample within `38`, which may precede the nearest approach"
// (`specs/simulation.md`, Collision). Where the fault leaves the clock is fixed in
// Cycles and the clock: "A `collision` leaves the fraction at that sample's
// `k / 8`".
//
// THE CONFIGURATION is example A, which the specification chose to separate the
// two: "An arm at `(0, 0)`, length 1, carries a mote from `(1, 0)` toward `(0, 1)`
// with `rotate-cw`. A mote rests on `(1, 1)`." First sample within `38`: `36.10`
// at `t = 3/8`. Nearest sampled approach: `35.14` at `t = 4/8`.
//
// THE VERDICT. `sim.fraction` is `3/8` and not `4/8`. Both are samples within
// `38`, so a build that faulted at the nearest approach rather than at the first
// one still faults — and this is the check that tells the two apart. The reading
// is a strict one: an eighth of a cycle separates the two answers, far outside the
// rounding `specs/instrumentation.md` allows a running sum.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import {
  advanceCycles,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { exampleA } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("freezes at t = 3/8, the first sample within 38, not at t = 4/8, the nearest", async () => {
  await exampleA(h);

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "frozen");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "example A comes within 38, so the run faults as collision",
  );
  assertGreaterThan(
    Math.abs((sim?.fraction ?? -1) - sampleFraction(4)),
    FRACTION_TOLERANCE,
    "the run does not run on to the nearest approach at 35.14, t = 4/8",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(3),
    FRACTION_TOLERANCE,
    "the samples are evaluated in order, so the run freezes at 36.10, t = 3/8",
  );
});
