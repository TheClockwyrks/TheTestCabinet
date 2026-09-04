// collision/example-f-slide-ending-adjacent-clears — worked example F of
// `specs/simulation.md`.
//
// THE RULE. The threshold is strict: a run faults only when two centers are
// "strictly less than `2 * MOTE_COLLIDE_R` (`38`)" apart at a sample
// (`specs/simulation.md`, Collision). Adjacent hex centers stand `HEX_PITCH`
// (`48`) apart (`specs/field.md`), so a move that ENDS one hex from a resting mote
// ends clear of the threshold rather than on it.
//
// THE CONFIGURATION, quoted from the worked-example table: "The same slide, with
// the resting mote on `(3, -1)`" — the piston slide of example E, from `(1, 0)` to
// `(2, 0)`, with the resting mote moved to the hex the carry finishes beside.
// First sample within `38`: "none". Nearest sampled approach: `48.00` at
// `t = 8/8`. Outcome: "Clear".
//
// THE VERDICT. The last sample, `t = 8/8`, is the nearest one and it is still
// clear, so the cycle reaches its boundary: `sim.cycle` at `1`, `sim.fraction`
// back at `0`, `sim.status` `running`, and `sim.fault` `null`.
//
// AND THE SLIDE REALLY RAN. The carried mote is read back on `(2, 0)`, one hex
// from the resting mote still on `(3, -1)` — which is what makes `48.00` at
// `t = 8/8` the separation this item is about rather than a figure a motionless
// build would also report.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  type Harness,
} from "../harness";
import { exampleF } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends one hex from a resting mote at 48.00 and reaches its boundary", async () => {
  const posed = await exampleF(h);

  await captureReplay(h, "clear", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "ending at rest separation is not a collision: 48.00 is not strictly less than 38",
  );
  assertNull(
    sim?.fault ?? null,
    "a run that reached no sample within 38 raises no fault",
  );
  assertEqual(
    sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );
  const [carried] = posed.carried;
  const [resting] = posed.resting;
  assertEqual(
    `${moteById(snapshot, carried as number)?.q},${moteById(snapshot, carried as number)?.r}`,
    "2,0",
    "extend carried the mote from (1, 0) to (2, 0): the slide really ran",
  );
  assertEqual(
    `${moteById(snapshot, resting as number)?.q},${moteById(snapshot, resting as number)?.r}`,
    "3,-1",
    "a mote held by nothing rests on its hex for the whole cycle",
  );
});
