// collision/example-e-piston-slide-clears — worked example E of
// `specs/simulation.md`.
//
// THE RULE. A run faults as `collision` only when "at any sample the distance
// between the centers of two motes is strictly less than `2 * MOTE_COLLIDE_R`
// (`38`)" (`specs/simulation.md`, Collision). A translation is sampled at the same
// eight fractions a sweep is: "`extend`, `retract` — The piston's length changes
// by one, its gripper translating one hex along its spoke ... Translation by the
// same vector, linearly in `t`" (Motion and carrying).
//
// THE CONFIGURATION, quoted from the worked-example table: "A piston extends,
// carrying a mote from `(1, 0)` to `(2, 0)`. A mote rests on `(2, -1)`." First
// sample within `38`: "none". Nearest sampled approach: `41.57` at `t = 4/8`.
// Outcome: "Clear".
//
// THE VERDICT. The cycle reaches its boundary: `sim.cycle` at `1`,
// `sim.fraction` back at `0`, `sim.status` `running`, and `sim.fault` `null`. The
// piston slides the whole hex past a mote flanking its path without the pair ever
// reaching `38`.
//
// AND THE SLIDE REALLY RAN. The carried mote is read back on `(2, 0)` and the
// resting mote still on `(2, -1)`: `extend` translates the gripper "one hex
// along its spoke" and imposes "translation by the same vector" on what it
// holds. Without that reading a build whose pistons never move clears the
// configuration by standing still.
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
import { exampleE } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("slides a carried mote past a flanking mote and reaches its boundary", async () => {
  const posed = await exampleE(h);

  await captureReplay(h, "clear", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "no sample of example E comes within 38, so nothing faults the run",
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
    "2,-1",
    "a mote held by nothing rests on its hex for the whole cycle",
  );
});
