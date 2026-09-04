// collision/collision-names-colliding-motes — a collision names the two motes of
// the pair within `38`.
//
// THE RULE. The collision rule "faults as `collision` at that sample, naming every
// pair within the threshold at that sample" (`specs/simulation.md`, Collision),
// and the payload table says which list they land in: "`collision` — `parts`:
// empty; `motes`: every mote of every pair within `38` at that sample" (Faults),
// with "`motes` is in ascending mote id".
//
// THE CONFIGURATION is example A: "An arm at `(0, 0)`, length 1, carries a mote
// from `(1, 0)` toward `(0, 1)` with `rotate-cw`. A mote rests on `(1, 1)`." The
// two motes are the whole of the field, so the reading is unambiguous about which
// pair the fault is naming.
//
// THE VERDICT. `sim.fault.motes` holds exactly the carried mote and the resting
// mote, in ascending id — both of them, rather than only the one that moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
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

it("names both motes of the colliding pair, in ascending mote id", async () => {
  const posed = await exampleA(h);

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "named");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "example A comes within 38, so the run faults as collision",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [...posed.carried, ...posed.resting].sort((a, b) => a - b),
    "the fault names the carried mote and the mote it met, in ascending mote id",
  );
});
