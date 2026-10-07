// collision/overretracted — `retract` on a piston already at `ARM_MIN_LEN` is
// `overretracted`.
//
// THE RULE. "`overretracted` — `retract` on a piston already at `ARM_MIN_LEN`
// (`1`)" (`specs/simulation.md`, Faults), raised at the fetch like every other
// instruction a part cannot perform: "A non-blank cell the part cannot perform
// raises the fault named for it under Faults" (Cycles and the clock). "Length is a
// whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)"
// (`specs/parts.md`), and `retract` "A piston's length falls by one"
// (`specs/instructions.md`), so at `1` there is nowhere to fall to.
//
// THE CONFIGURATION. One piston at `(0, 0)`, rest length `1`, with `retract` in
// tape cell `0`. The run starts every arm at its rest pose, so the piston begins at
// the minimum. It is the only part placed and the field is empty.
//
// THE VERDICT. `sim.status` is `faulted`, `sim.fault.kind` is `overretracted`, the
// fraction is `0`, and the piston's live length is still `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as overretracted when a piston at length 1 fetches retract", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, ARM_MIN_LEN, ["retract"])]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "faulted");

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.status,
    "faulted",
    "the cycle faults rather than completing",
  );
  assertEqual(
    sim?.fault?.kind,
    "overretracted",
    "retract on a piston already at ARM_MIN_LEN (1) is overretracted",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a fetch fault leaves the fraction at 0, because no motion ran",
  );
  assertEqual(
    poseOf(snapshot, piston)?.length,
    ARM_MIN_LEN,
    "the piston is still at ARM_MIN_LEN: the fetch refused before anything moved",
  );
});
