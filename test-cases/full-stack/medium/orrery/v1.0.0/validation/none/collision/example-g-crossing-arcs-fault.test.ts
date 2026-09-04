// collision/example-g-crossing-arcs-fault — worked example G of
// `specs/simulation.md`.
//
// THE RULE. "Every pair is checked, fixtures included" (`specs/simulation.md`,
// Collision), so a pair of MOVING motes is checked against each other and not only
// against motes at rest. Both arcs are sampled at the same eight fractions, and
// the distance compared is between the two positions at that one fraction.
//
// THE CONFIGURATION, quoted from the worked-example table: "Two arms swap two
// motes between `(1, 0)` and `(0, 1)`, one rotating clockwise about `(0, 0)` and
// the other clockwise about `(1, 1)`." First sample within `38`: `37.16` at
// `t = 1/8`. Nearest sampled approach: `12.86` at `t = 4/8`. Outcome: "Faults".
//
// The second arm is anchored on `(1, 1)` at rotation `3`, so its gripper stands at
// "base + length * DIRS[d]" with `DIRS[3]` `(-1, 0)` (`specs/parts.md`,
// `specs/field.md`) — on `(0, 1)`, holding the mote it swaps.
//
// THE VERDICT. The run faults as `collision`, frozen at the first sample within
// `38`, `t = 1/8`, rather than at their nearest approach at `t = 4/8`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { exampleG } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as collision when two carried motes cross, at t = 1/8", async () => {
  await exampleG(h);

  await captureReplay(h, "faulted", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "two motes both in motion are checked against each other, and example G comes within 38",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "two mote centers strictly closer than 2 * MOTE_COLLIDE_R (38) fault as collision",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(1),
    FRACTION_TOLERANCE,
    "37.16 at t = 1/8 is the first sample within 38, and a collision freezes there",
  );
  assertEqual(
    sim?.cycle,
    0,
    "a faulting boundary leaves sim.cycle at the cycle just run",
  );
});
