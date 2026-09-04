// instructions/unperformable-faults-at-fetch — a fetch fault stops the cycle
// before anything has moved.
//
// THE RULE, in the cycle's own order (`specs/simulation.md`, Cycles and the
// clock):
//
//   1. Fetch. "A non-blank cell the part cannot perform raises the fault named
//      for it under Faults."
//   ...
//   4. Motion. "The moving parts sweep across the cycle."
//
// And "A fault freezes the run where it stood: the status becomes `faulted` and
// nothing advances further" (Faults). The fault raised at step 1 therefore stops
// the cycle before step 4, so no part's pose moves at all — not the faulting
// part's, and not any other part's. `sim.poses` is where a pose is read: "one
// entry per arm and wheel: its live rotation, length, and base cell. Parts at
// rest between instructions still have their entry" (`specs/state.md`).
//
// THE CONFIGURATIONS. Two, one per fetch fault the item names, each posed on its
// own bare run with three parts and an empty field:
//
//   * the SUBJECT at `(0, 0)`, whose cell the fetch refuses — `advance` on an arm
//     standing on no track ("`unmounted` — `advance` or `recede` on a part not on
//     a track"), then `extend` on an arm ("`impossible` — `extend` or `retract`
//     on a part that is not a piston");
//   * an arm at `(0, 3)` with `rotate-cw`, which it CAN perform and which would
//     turn it one step were the motion step ever reached;
//   * a piston at `(3, 0)` at rest length `1` with `extend`, which it CAN perform
//     and which would lengthen it were the motion step ever reached.
//
// Only the subject's cell is unperformable, so it is the one part the fetch
// faults on, and the other two are the reading: a build that ran the motion
// before deciding the fetch moves them.
//
// THE VERDICT. The run faults with the kind the configuration posed, and every
// entry of `sim.poses` still carries the rotation, the length and the base cell
// it carried when the cycle began — read part by part, and only after the
// BEFORE reading has been shown to be there at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, type InstructionName } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN, SOUTH } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
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

/** One fetch fault: the cell the subject holds, and what it raises. */
const CASES: readonly { cell: InstructionName; kind: string }[] = [
  { cell: "advance", kind: "unmounted" },
  { cell: "extend", kind: "impossible" },
];

it("leaves every pose at the rotation, length and cell it began the cycle with", async () => {
  for (const { cell, kind } of CASES) {
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([
        armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [cell]),
        armPart("arm", SOUTH.q, SOUTH.r, 0, 1, ["rotate-cw"]),
        armPart("piston", at(3, 0).q, at(3, 0).r, 0, 1, ["extend"]),
      ]),
    });
    const placed = await partIds(h);

    const before = await h.snapshot();
    assertLength(
      before.sim?.poses ?? [],
      placed.length,
      `${kind}: the run carries one live pose per arm and wheel before the cycle`,
    );
    for (const part of placed) {
      assertNotNull(
        poseOf(before, part),
        `${kind}: the run carries a live pose for part ${part} before the cycle`,
      );
    }

    const drive = async (): Promise<void> => {
      await advanceCycles(h, 1);
      await h.advance(1);
    };
    await (kind === "unmounted"
      ? captureReplay(h, "frozen-at-fetch", drive)
      : drive());

    const after = await h.snapshot();
    assertNotNull(after.sim, `${kind}: the run is still live after the fault`);
    assertEqual(
      after.sim?.status,
      "faulted",
      `${kind}: the fetch refuses the subject's cell, so the cycle faults`,
    );
    assertEqual(
      after.sim?.fault?.kind,
      kind,
      `${kind}: the configuration raises the fault it posed`,
    );
    assertNear(
      after.sim?.fraction ?? -1,
      0,
      FRACTION_TOLERANCE,
      `${kind}: every fault but a collision leaves the fraction at 0`,
    );
    assertLength(
      after.sim?.poses ?? [],
      placed.length,
      `${kind}: the run still carries one live pose per arm and wheel`,
    );
    for (const part of placed) {
      const was = poseOf(before, part);
      const now = poseOf(after, part);
      assertNotNull(
        now,
        `${kind}: the run still carries a live pose for part ${part}`,
      );
      assertEqual(
        now?.rotation,
        was?.rotation,
        `${kind}: part ${part} is at the rotation it began the cycle with, because the fault preceded the motion`,
      );
      assertEqual(
        now?.length,
        was?.length,
        `${kind}: part ${part} is at the length it began the cycle with`,
      );
      assertEqual(
        `${now?.cell.q},${now?.cell.r}`,
        `${was?.cell.q},${was?.cell.r}`,
        `${kind}: part ${part} is on the base cell it began the cycle with`,
      );
    }
  }
});
