// collision/example-c-long-sweep-clears-inner-ring — worked example C of
// `specs/simulation.md`.
//
// THE RULE. A run faults as `collision` only when "at any sample the distance
// between the centers of two motes is strictly less than `2 * MOTE_COLLIDE_R`
// (`38`)" (`specs/simulation.md`, Collision). A mote swept along the outer ring
// passes a mote resting on the inner ring without ever reaching that threshold.
//
// THE CONFIGURATION, quoted from the worked-example table: "An arm at `(0, 0)`,
// length 2, carries a mote from `(2, 0)` toward `(0, 2)` with `rotate-cw`. A mote
// rests on `(1, 0)`." First sample within `38`: "none". Nearest sampled approach:
// `48.81` at `t = 1/8`. Outcome: "Clear".
//
// The arm's length is `2`, so its gripper stands at "base + length * DIRS[d]"
// (`specs/parts.md`) — `(2, 0)` — and the clockwise sweep carries it to `(0, 2)`,
// past the resting mote one ring in.
//
// THE VERDICT. The cycle reaches its boundary: `sim.cycle` at `1`,
// `sim.fraction` back at `0`, `sim.status` `running`, and `sim.fault` `null`.
//
// AND THE SWEEP REALLY RAN. The carried mote is read back on `(0, 2)` — the
// length 2 offset `(2, 0)` turned one clockwise step by the formula of
// `specs/field.md` — and the resting mote still on `(1, 0)`. Without that
// reading a build whose arms never move clears the configuration by standing
// still.

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
import { exampleC } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sweeps a length 2 arm past a mote on the inner ring and reaches its boundary", async () => {
  const posed = await exampleC(h);

  await captureReplay(h, "clear", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "no sample of example C comes within 38, so nothing faults the run",
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
    "0,2",
    "rotate-cw carried the mote from (2, 0) to (0, 2): the sweep really ran",
  );
  assertEqual(
    `${moteById(snapshot, resting as number)?.q},${moteById(snapshot, resting as number)?.r}`,
    "1,0",
    "a mote held by nothing rests on its hex for the whole cycle",
  );
});
