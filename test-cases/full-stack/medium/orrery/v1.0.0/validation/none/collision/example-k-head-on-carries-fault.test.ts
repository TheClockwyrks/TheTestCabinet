// collision/example-k-head-on-carries-fault — worked example K of
// `specs/simulation.md`.
//
// THE RULE. Every pair is sampled at `t = k / 8` "for `k` from `1` to `8`, in
// order", and "a faulting run freezes at the first sample within `38`, which may
// precede the nearest approach" (`specs/simulation.md`, Collision). Two carries
// closing head on cross the threshold well before they meet.
//
// THE CONFIGURATION, quoted from the worked-example table: "An open track through
// `(-1, 0)`, `(0, 0)`, `(1, 0)`, `(2, 0)`, `(3, 0)`. An arm at `(-1, 0)` carries a
// mote on `(0, 0)` and advances; an arm at `(3, 0)` carries a mote on `(2, 0)` and
// recedes." First sample within `38`: `36.00` at `t = 5/8`. Nearest sampled
// approach: `0.00` at `t = 8/8`. Outcome: "Faults".
//
// The advancing arm is at rotation `0` (`DIRS[0]` is `(+1, 0)`) so its gripper is
// on `(0, 0)`; the receding arm is at rotation `3` (`DIRS[3]` is `(-1, 0)`) so its
// gripper is on `(2, 0)` (`specs/parts.md`, `specs/field.md`). Both grippers would
// land on `(1, 0)`.
//
// THE VERDICT. The run faults as `collision` at `t = 5/8` — where the two first
// come within `38` — rather than at `t = 8/8`, where they would have met.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { exampleK } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as collision at t = 5/8, before the two carries meet at t = 8/8", async () => {
  await exampleK(h);

  await captureReplay(h, "faulted", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "two carries closing head on come within 38, so the cycle faults",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "two mote centers strictly closer than 2 * MOTE_COLLIDE_R (38) fault as collision",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(5),
    FRACTION_TOLERANCE,
    "36.00 at t = 5/8 is the first sample within 38, and a collision freezes there rather than at their meeting at t = 8/8",
  );
  assertEqual(
    sim?.cycle,
    0,
    "a faulting boundary leaves sim.cycle at the cycle just run",
  );
});
