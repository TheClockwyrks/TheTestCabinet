// instructions/wheel-rejects-other-instructions — everything but a rotation on a
// wheel is `impossible`.
//
// THE RULE. "A wheel executes only `rotate-cw` and `rotate-ccw`"
// (`specs/instructions.md`), and `specs/simulation.md` names what a wheel given
// anything else raises: "`impossible` — `extend` or `retract` on a part that is
// not a piston, or any non-blank instruction but `rotate-cw` or `rotate-ccw` on a
// wheel" (Faults). It is raised at the FETCH, the cycle's first step: "Each part
// reads its tape cell for this cycle ... A non-blank cell the part cannot perform
// raises the fault named for it under Faults" (Cycles and the clock). And a fetch
// fault names its part: "Every fetch fault — `parts`: the faulting part; `motes`:
// empty" (Faults).
//
// THE CONFIGURATIONS. Six, one per non-blank instruction that is neither
// rotation and is not itself a track instruction: `grab`, `drop`, `pivot-cw`,
// `pivot-ccw`, `extend` and `retract`. (`advance` and `recede` on a wheel are the
// same rule reached through a second one, and the precedence item decides them.)
// Each is posed on its own bare run, with a BYSTANDER arm at `(0, 3)` placed
// FIRST, carrying an entirely blank tape — "A blank cell is a rest on every part,
// a wheel included, and never faults" — so `parts` naming the wheel is a reading
// about which part faulted rather than about which part exists, and a build that
// answers the first placed part rather than the faulting one is caught.
//
// THE VERDICT. In every case `sim.status` is `faulted`, `sim.fault.kind` is
// `impossible`, and `sim.fault.parts` is exactly the wheel's id.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { armPart, solution } from "../formats";
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

/** The six the item names: every non-rotation instruction but `advance` and `recede`. */
const REFUSED: readonly InstructionName[] = [
  "grab",
  "drop",
  "pivot-cw",
  "pivot-ccw",
  "extend",
  "retract",
];

it("faults as impossible, naming the wheel, on every instruction but a rotation", async () => {
  for (const instruction of REFUSED) {
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([
        armPart("arm", SOUTH.q, SOUTH.r, 0, 1, []),
        armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, [instruction]),
      ]),
    });
    const wheel = (await partIds(h))[1] ?? -1;

    const drive = async (): Promise<void> => {
      await advanceCycles(h, 1);
      await h.advance(1);
    };
    await (instruction === "grab"
      ? captureReplay(h, "wheel-fault", drive)
      : drive());

    const sim = (await h.snapshot()).sim;
    assertNotNull(sim, `the run is still live after the ${instruction} fault`);
    assertEqual(
      sim?.status,
      "faulted",
      `a wheel given ${instruction} faults rather than running the cycle out`,
    );
    assertEqual(
      sim?.fault?.kind,
      "impossible",
      `any non-blank instruction but rotate-cw or rotate-ccw on a wheel faults as impossible, ${instruction} included`,
    );
    assertDeepEqual(
      sim?.fault?.parts,
      [wheel],
      `the ${instruction} fault names the wheel that could not perform its cell, and not the resting arm`,
    );
  }
});
