// instructions/extend-is-piston-only — `extend` on anything but a piston is
// `impossible`.
//
// THE RULE. "`extend` and `retract` belong to the `piston` alone"
// (`specs/instructions.md`, The instruction set), and `specs/simulation.md` names
// the fault: "`impossible` — `extend` or `retract` on a part that is not a
// piston" (Faults). It is raised at the FETCH: "Each part reads its tape cell for
// this cycle ... A non-blank cell the part cannot perform raises the fault named
// for it under Faults" (Cycles and the clock). And a fetch fault names its part:
// "Every fetch fault — `parts`: the faulting part; `motes`: empty".
//
// THE CONFIGURATIONS. Four, one per arm kind that is not a piston: `arm`,
// `biarm`, `triarm` and `hexarm` — the five arm kinds of `specs/parts.md` less
// the one the instruction belongs to. Each is at rest length `ARM_MIN_LEN` (`1`),
// so nothing about a LENGTH BOUND is in play and the only thing wrong with the
// cell is the class of the part holding it.
//
// Each is posed on its own bare run beside a BYSTANDER arm at `(0, 3)`, placed
// FIRST, carrying an entirely blank tape — "A blank cell is a rest on every part,
// a wheel included, and never faults" — so `parts` naming the subject is a
// reading about which part faulted rather than about which part exists.
//
// THE VERDICT. In every case `sim.status` is `faulted`, `sim.fault.kind` is
// `impossible`, and `sim.fault.parts` is exactly the subject's id.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN, type PartName } from "../constants";
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

/** The arm kinds of `specs/parts.md` that are not the piston. */
const NOT_PISTONS: readonly PartName[] = ["arm", "biarm", "triarm", "hexarm"];

it("faults as impossible, naming the part, when a part that is not a piston fetches extend", async () => {
  for (const kind of NOT_PISTONS) {
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([
        armPart("arm", SOUTH.q, SOUTH.r, 0, 1, []),
        armPart(kind, ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["extend"]),
      ]),
    });
    const subject = (await partIds(h))[1] ?? -1;

    const drive = async (): Promise<void> => {
      await advanceCycles(h, 1);
      await h.advance(1);
    };
    await (kind === "arm" ? captureReplay(h, "extend-fault", drive) : drive());

    const sim = (await h.snapshot()).sim;
    assertNotNull(sim, `the run is still live after the ${kind}'s fault`);
    assertEqual(
      sim?.status,
      "faulted",
      `a ${kind} given extend faults rather than running the cycle out`,
    );
    assertEqual(
      sim?.fault?.kind,
      "impossible",
      `extend on a ${kind}, which is not a piston, faults as impossible`,
    );
    assertDeepEqual(
      sim?.fault?.parts,
      [subject],
      `the fault names the ${kind} that could not perform its cell, and not the resting arm`,
    );
  }
});
