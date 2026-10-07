// collision/example-b-sweep-away-clears — worked example B of
// `specs/simulation.md`.
//
// THE RULE. A run faults as `collision` only when "at any sample the distance
// between the centers of two motes is strictly less than `2 * MOTE_COLLIDE_R`
// (`38`)" (`specs/simulation.md`, Collision). A configuration that never reaches
// that threshold at any of the eight samples runs its cycle out.
//
// THE CONFIGURATION, quoted from the worked-example table: "The same sweep, with
// the resting mote on `(1, -1)`" — the length 1 clockwise sweep of example A,
// carrying a mote from `(1, 0)` toward `(0, 1)`, with the resting mote moved to
// the far side. First sample within `38`: "none". Nearest sampled approach:
// `53.33` at `t = 1/8`. Outcome: "Clear".
//
// THE VERDICT. The cycle reaches its boundary: "A cycle completes when the
// accumulated fraction reaches `1`", and "a span of game time that lands exactly
// on a boundary completes that cycle however many frames covered it". So one cycle
// of game time leaves `sim.cycle` at `1`, `sim.fraction` back at `0`,
// `sim.status` `running`, and `sim.fault` `null`.
//
// THE PAIR IS THE ONLY PAIR. The poser clears the field and spawns back exactly
// the carried mote and the resting mote, so the reading is about those two and no
// other pair can clear or fault in their place.
//
// AND THE SWEEP REALLY RAN. The carried mote is read back on `(0, 1)` and the
// resting mote still on `(1, -1)`: "The part's direction turns 60 degrees about
// its base, clockwise" carrying "the same rotation about the base"
// (`specs/simulation.md`, Motion and carrying), and "at `t = 1` every mote lands
// exactly on a hex center". Without that reading a build whose arms never move
// clears every configuration in the table, and a "clear" item that a frozen
// machine passes decides nothing.
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
import { exampleB } from "./examples";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches its boundary still running, its nearest sampled approach being 53.33", async () => {
  const posed = await exampleB(h);

  await captureReplay(h, "clear", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "no sample of example B comes within 38, so nothing faults the run",
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
    "0,1",
    "rotate-cw carried the mote from (1, 0) to (0, 1): the sweep really ran",
  );
  assertEqual(
    `${moteById(snapshot, resting as number)?.q},${moteById(snapshot, resting as number)?.r}`,
    "1,-1",
    "a mote held by nothing rests on its hex for the whole cycle",
  );
});
