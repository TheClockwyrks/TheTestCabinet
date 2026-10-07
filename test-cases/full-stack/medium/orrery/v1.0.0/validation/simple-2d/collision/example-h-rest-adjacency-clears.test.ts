// collision/example-h-rest-adjacency-clears — worked example H of
// `specs/simulation.md`.
//
// THE RULE. The threshold is `2 * MOTE_COLLIDE_R` (`38`) and adjacent hex centers
// stand `HEX_PITCH` (`48`) apart (`specs/field.md`), so two motes AT REST on
// adjacent hexes are never within it. "At rest a mote sits exactly on a hex
// center, and at most one mote occupies a hex" (`specs/field.md`), and "a mote
// held by nothing rests on its hex for the whole cycle"
// (`specs/simulation.md`, Motion and carrying).
//
// THE CONFIGURATION, quoted from the worked-example table: "Two motes rest on
// `(0, 0)` and `(1, 0)`. Nothing moves." First sample within `38`: "none".
// Nearest sampled approach: `48.00` at every sample. Outcome: "Clear".
//
// "Nothing moves" is posed as the empty machine the bare run opens with: no part
// is placed, so no instruction is fetched and nothing imposes a motion on either
// mote. The two motes are the whole of the world.
//
// THE VERDICT. The cycle reaches its boundary: `sim.cycle` at `1`,
// `sim.fraction` back at `0`, `sim.status` `running`, and `sim.fault` `null`, and
// both motes are still resting where they were spawned.

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
import { exampleH } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds two motes at rest on adjacent hexes through a whole cycle", async () => {
  const posed = await exampleH(h);

  await captureReplay(h, "clear", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "motes at rest on adjacent hexes hold 48.00, which is not within 38",
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
  const [origin, east] = posed.resting;
  assertEqual(
    `${moteById(snapshot, origin as number)?.q},${moteById(snapshot, origin as number)?.r}`,
    "0,0",
    "a mote held by nothing rests on its hex for the whole cycle",
  );
  assertEqual(
    `${moteById(snapshot, east as number)?.q},${moteById(snapshot, east as number)?.r}`,
    "1,0",
    "a mote held by nothing rests on its hex for the whole cycle",
  );
});
