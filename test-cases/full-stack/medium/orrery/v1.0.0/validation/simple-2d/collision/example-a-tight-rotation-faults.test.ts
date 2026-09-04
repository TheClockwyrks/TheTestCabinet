// collision/example-a-tight-rotation-faults — worked example A of
// `specs/simulation.md`.
//
// THE RULE. "`COLLISION_SAMPLES` is `8`. Within the motion step, every mote's
// position is evaluated at the sample fractions `t = k / 8` for `k` from `1` to
// `8`, in order. If at any sample the distance between the centers of two motes is
// strictly less than `2 * MOTE_COLLIDE_R` (`38`), the run faults as `collision` at
// that sample" (`specs/simulation.md`, Collision).
//
// THE CONFIGURATION, quoted from the worked-example table: "An arm at `(0, 0)`,
// length 1, carries a mote from `(1, 0)` toward `(0, 1)` with `rotate-cw`. A mote
// rests on `(1, 1)`." First sample within `38`: `36.10` at `t = 3/8`. Nearest
// sampled approach: `35.14` at `t = 4/8`. Outcome: "Faults".
//
// THE VERDICT. The cycle does not reach its boundary: `sim.status` is `faulted`
// and `sim.fault.kind` is `collision`. It froze at the FIRST sample within `38`
// rather than at the nearest approach — "A faulting run freezes at the first
// sample within `38`, which may precede the nearest approach" — and "a
// `collision` leaves the fraction at that sample's `k / 8`", so `sim.fraction` is
// `3/8`. "A completing or faulting boundary leaves `sim.cycle` at the cycle just
// run", so the counter is still on cycle `0`.
//
// THE WORLD IS POSED, NOT SEARCHED. The poser opens a bare run — reset, a posed
// challenge, an empty machine, the completion switch held off, a live run, an
// empty field — and spawns back one arm, the mote it carries and the mote that
// rests. Nothing else is on the field, so nothing else can be what faulted. The
// hold is given with `setGrip`, "which takes hold with no `grab` ever running", so
// the only cycle that runs is the one under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import {
  advanceCycles,
  captureReplay,
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

it("faults as collision at t = 3/8, where the sweep first comes within 38", async () => {
  await exampleA(h);

  await captureReplay(h, "faulted", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "example A comes within 38 at t = 3/8, so the cycle faults rather than completing",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "two mote centers strictly closer than 2 * MOTE_COLLIDE_R (38) fault as collision",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(3),
    FRACTION_TOLERANCE,
    "a collision leaves the fraction at that sample's k / 8, and 36.10 at t = 3/8 is the first sample within 38",
  );
  assertEqual(
    sim?.cycle,
    0,
    "a faulting boundary leaves sim.cycle at the cycle just run",
  );
});
