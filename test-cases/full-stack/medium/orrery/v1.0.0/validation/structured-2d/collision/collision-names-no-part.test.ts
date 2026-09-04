// collision/collision-names-no-part — a collision names no part.
//
// THE RULE, from the payload table of `specs/simulation.md` (Faults):
// "`collision` — `parts`: empty; `motes`: every mote of every pair within `38` at
// that sample." No part is at fault in a collision: what the rule found is a pair
// of motes, and the arms that were carrying them were each performing an
// instruction they could perform.
//
// THE CONFIGURATION is example G, chosen because BOTH motes are being carried, by
// two different arms: "Two arms swap two motes between `(1, 0)` and `(0, 1)`, one
// rotating clockwise about `(0, 0)` and the other clockwise about `(1, 1)`."
// Neither arm's `rotate-cw` is an instruction it cannot perform, so if a build
// blamed the carriers, there are two of them here to blame.
//
// THE VERDICT. `sim.fault.parts` is empty, while `sim.fault.motes` names the pair
// — so the emptiness is the payload rule rather than a fault that failed to fill
// anything in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  advanceCycles,
  captureStill,
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

it("reports an empty sim.fault.parts even though two arms were carrying", async () => {
  const posed = await exampleG(h);

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "parts");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "example G comes within 38, so the run faults as collision",
  );
  assertEqual(
    posed.parts.length,
    2,
    "two arms were carrying, so a build that blamed a carrier had two to name",
  );
  assertDeepEqual(
    sim?.fault?.parts,
    [],
    "a collision names no part, whichever arms were carrying the motes that met",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [...posed.carried].sort((a, b) => a - b),
    "the motes that met are named, so the empty parts list is the rule rather than an unfilled fault",
  );
});
