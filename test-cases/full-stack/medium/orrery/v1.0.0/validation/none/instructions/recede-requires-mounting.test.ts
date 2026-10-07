// instructions/recede-requires-mounting — `recede` on a part standing on no
// track is `unmounted`.
//
// THE RULE. "`advance` and `recede` need the part to be mounted on a track"
// (`specs/instructions.md`, The instruction set), and `specs/simulation.md` names
// the fault: "`unmounted` — `advance` or `recede` on a part not on a track"
// (Faults). What mounting IS comes from `specs/parts.md`: "An arm or wheel whose
// anchor hex is a cell of a track is mounted on that track ... Mounting is
// positional." The fault is raised at the FETCH: "Each part reads its tape cell
// for this cycle ... A non-blank cell the part cannot perform raises the fault
// named for it under Faults" (Cycles and the clock), and it names its part:
// "Every fetch fault — `parts`: the faulting part; `motes`: empty".
//
// THE CONFIGURATION. Three parts, in this placement order:
//
//   1. a three-cell open track along `(-1, -3)`, `(0, -3)`, `(1, -3)`, so the
//      machine HAS a track and the reading is about the subject's anchor being a
//      cell of none rather than about a machine with no track at all;
//   2. a BYSTANDER arm at `(0, 3)` with an entirely blank tape — "A blank cell is
//      a rest on every part, a wheel included, and never faults" — so `parts`
//      naming the subject is a reading about which part faulted;
//   3. the SUBJECT arm at `(0, 0)`, whose anchor is a cell of no track, with
//      `recede` in its only cell.
//
// THE VERDICT. `sim.status` is `faulted`, `sim.fault.kind` is `unmounted`, and
// `sim.fault.parts` is exactly the subject's id.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN, SOUTH } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as unmounted, naming the arm, when an arm on no track fetches recede", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(-1, -3), at(0, -3), at(1, -3)]),
      armPart("arm", SOUTH.q, SOUTH.r, 0, 1, []),
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["recede"]),
    ]),
  });
  const subject = (await partIds(h))[2] ?? -1;

  await captureReplay(h, "recede-fault", async () => {
    await advanceCycles(h, 1);
    await h.advance(1);
  });

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.status,
    "faulted",
    "the cycle faults rather than running to its boundary",
  );
  assertEqual(
    sim?.fault?.kind,
    "unmounted",
    "recede on a part whose anchor hex is a cell of no track faults as unmounted",
  );
  assertDeepEqual(
    sim?.fault?.parts,
    [subject],
    "the fault names the arm that could not perform its cell, and not the resting arm",
  );
});
