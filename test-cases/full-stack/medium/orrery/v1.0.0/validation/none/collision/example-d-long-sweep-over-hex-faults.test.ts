// collision/example-d-long-sweep-over-hex-faults — worked example D of
// `specs/simulation.md`.
//
// THE RULE. The samples are taken "for `k` from `1` to `8`, in order", and "a
// faulting run freezes at the first sample within `38`, which may precede the
// nearest approach" (`specs/simulation.md`, Collision).
//
// THE CONFIGURATION, quoted from the worked-example table: "The same sweep, with
// the resting mote on `(1, 1)`" — the length 2 clockwise sweep of example C, from
// `(2, 0)` toward `(0, 2)`, with the resting mote moved onto the hex the arc
// passes over. First sample within `38`: `37.16` at `t = 1/8`. Nearest sampled
// approach: `12.86` at `t = 4/8`. Outcome: "Faults".
//
// THE VERDICT. The run faults as `collision`, and it freezes at `t = 1/8` — the
// FIRST sample within `38` — rather than at `t = 4/8`, where the two are nearest.
// "A `collision` leaves the fraction at that sample's `k / 8`", so `sim.fraction`
// is `1/8`, and the cycle counter is still on the cycle just run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { exampleD } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as collision at t = 1/8 rather than at its nearest approach at t = 4/8", async () => {
  await exampleD(h);

  await captureReplay(h, "faulted", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "example D comes within 38 at t = 1/8, so the cycle faults rather than completing",
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
    "37.16 at t = 1/8 is the first sample within 38, and a collision freezes there rather than at 12.86 at t = 4/8",
  );
  assertEqual(
    sim?.cycle,
    0,
    "a faulting boundary leaves sim.cycle at the cycle just run",
  );
});
