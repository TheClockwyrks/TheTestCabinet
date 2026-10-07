// collision/overextended — `extend` on a piston already at `ARM_MAX_LEN` is
// `overextended`.
//
// THE RULE. "`overextended` — `extend` on a piston already at `ARM_MAX_LEN` (`3`)"
// (`specs/simulation.md`, Faults). It is raised at the FETCH, the first step of the
// cycle: "1. Fetch. Each part reads its tape cell for this cycle ... A non-blank
// cell the part cannot perform raises the fault named for it under Faults"
// (Cycles and the clock). "Length is a whole number from `ARM_MIN_LEN` (`1`) to
// `ARM_MAX_LEN` (`3`)" (`specs/parts.md`), and `extend` "A piston's length rises by
// one" (`specs/instructions.md`), so at `3` there is nowhere to rise to.
//
// THE CONFIGURATION. One piston at `(0, 0)`, rest length `3`, with `extend` in
// tape cell `0`. "Each run starts every arm at its rest pose" (`specs/parts.md`),
// so the run begins with the piston already at the maximum. It is the only part
// placed and the field is empty, so nothing else can raise a fault in its place.
//
// THE VERDICT. `sim.status` is `faulted`, `sim.fault.kind` is `overextended`, the
// fraction is `0` — "every other fault and completion leaves it at `0`" — and the
// piston's live length is still `3`, because the fetch refused before any motion.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { ARM_MAX_LEN, FRACTION_TOLERANCE } from "../constants";
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

it("faults as overextended when a piston at length 3 fetches extend", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", 0, 0, 0, ARM_MAX_LEN, ["extend"])]),
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
    "overextended",
    "extend on a piston already at ARM_MAX_LEN (3) is overextended",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a fetch fault leaves the fraction at 0, because no motion ran",
  );
  assertEqual(
    poseOf(snapshot, piston)?.length,
    ARM_MAX_LEN,
    "the piston is still at ARM_MAX_LEN: the fetch refused before anything moved",
  );
});
