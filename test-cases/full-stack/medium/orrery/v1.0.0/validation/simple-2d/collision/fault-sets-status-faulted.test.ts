// collision/fault-sets-status-faulted — a fault sets the status to `faulted` and
// reports the fault that raised it.
//
// THE RULE. "`sim.status` is one of `running`, `paused`, `faulted`, and
// `complete`" (`specs/simulation.md`, Cycles and the clock), and "A fault freezes
// the run where it stood: the status becomes `faulted`" (Faults). What raised it
// is reported beside it: `sim.fault` carries a `kind` drawn from `FAULTS`, which
// "names every way a run halts", and the snapshot shape declares the field as
// `{ kind, parts: [...], motes: [...] } | null`
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION is example A, one arm carrying one mote past one resting mote,
// which the specification's own table says faults. The point here is not WHICH
// fault — that is each fault's own item — but that a raised fault leaves the run
// reporting itself as faulted rather than carrying on as `running` or sitting as
// `paused`, and that `sim.fault` is filled in rather than left `null`.
//
// THE VERDICT. `sim.status` is `faulted`, it is neither `running` nor `paused`,
// `sim.fault` is not `null`, and its `kind` is one of the seven `FAULTS` names.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import { FAULTS } from "../constants";
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

it("reports a faulted status and the fault that raised it", async () => {
  await exampleA(h);

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "status");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertNotEqual(
    sim?.status,
    "running",
    "a fault does not leave the run running",
  );
  assertNotEqual(
    sim?.status,
    "paused",
    "a fault does not leave the run paused",
  );
  assertEqual(sim?.status, "faulted", "a fault sets the status to faulted");
  assertNotNull(
    sim?.fault ?? null,
    "a faulted run reports the fault that raised it rather than a null",
  );
  assertContains(
    FAULTS as readonly string[],
    sim?.fault?.kind,
    "the reported kind is one of the FAULTS of specs/simulation.md",
  );
});
