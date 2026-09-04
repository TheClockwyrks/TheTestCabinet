// instructions/any-tape-may-carry-any-instruction — the editor writes an
// instruction into a cell whatever the part carrying that cell can do.
//
// THE RULE. "A wheel executes only `rotate-cw` and `rotate-ccw`; `extend` and
// `retract` belong to the `piston` alone; and `advance` and `recede` need the
// part to be mounted on a track. Any tape may carry any instruction, and an
// instruction the executing part cannot perform faults the run at the moment it
// is fetched" (`specs/instructions.md`, The instruction set). So what a part can
// perform is a RUN-TIME rule, decided at the fetch, and never an editing rule:
// the cell holds what was written into it.
//
// THE CONFIGURATION. Two parts on an otherwise empty machine, each given exactly
// the instruction its own class cannot perform:
//
//   * a wheel with `extend` — "`extend` and `retract` belong to the `piston`
//     alone", and a wheel is not even an arm;
//   * an arm standing on no track with `advance` — "`advance` and `recede` need
//     the part to be mounted on a track", and the machine holds no track at all,
//     so this arm is mounted on nothing.
//
// Nothing runs. The requirement is about what the EDITOR accepts, and a run would
// fetch these cells and fault, which is the other half of the same sentence and
// is decided by its own points.
//
// THE VERDICT. Each cell holds the instruction written into it, read back through
// `editor.parts`: "`tape` — the tape, for arms and wheels" (`specs/state.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotNull } from "../assert";
import { BARE, ORIGIN, SOUTH } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partsOfKind,
  placePart,
  writeTape,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds extend in a wheel's tape and advance in the tape of an arm on no track", async () => {
  await openChallengeDocument(h, BARE);
  const wheel = await placePart(h, "wheel", ORIGIN);
  const arm = await placePart(h, "arm", SOUTH);
  await writeTape(h, wheel, ["extend"]);
  await writeTape(h, arm, ["advance"]);

  await h.advance(1);
  await captureStill(h, "wheel-tape");

  const snapshot = await h.snapshot();
  assertLength(
    partsOfKind(snapshot, "track"),
    0,
    "no track is placed, so the arm's anchor hex is a cell of no track",
  );

  const turned = partById(snapshot, wheel);
  assertNotNull(
    turned,
    "the wheel is still on the machine after its tape was written",
  );
  assertDeepEqual(
    turned?.tape,
    ["extend"],
    "any tape may carry any instruction: a wheel's cell holds extend, which only a piston can perform",
  );

  const mounted = partById(snapshot, arm);
  assertNotNull(
    mounted,
    "the arm is still on the machine after its tape was written",
  );
  assertDeepEqual(
    mounted?.tape,
    ["advance"],
    "any tape may carry any instruction: an unmounted arm's cell holds advance, which needs a track",
  );
});
