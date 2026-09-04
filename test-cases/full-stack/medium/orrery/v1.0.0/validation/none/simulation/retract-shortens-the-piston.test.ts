// simulation/retract-shortens-the-piston — `retract` lowers a piston's length by
// one.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`extend`, `retract` — The piston's length changes by one, its gripper
// translating one hex along its spoke." `specs/instructions.md` fixes the
// direction — "`retract` — A piston's length falls by one" — and `specs/parts.md`
// fixes the range and whose length it is: "Length is a whole number from
// `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)... For a `piston` the chosen length is
// its rest length, and the `extend` and `retract` instructions change it at run
// time, faulting at the bounds as `specs/simulation.md` defines."
//
// Neither the base nor the rotation appears in that row, so neither moves: the
// gripper travels "along its spoke", which is the spoke the rotation already
// names.
//
// THE GRIPPER FOLLOWS FROM THE POSE. `specs/parts.md` puts "one gripper per spoke
// at `base + length * DIRS[d]`", so a length of `1` on a piston based at `(0, 0)`
// at rotation `0` stands its one gripper on `(1, 0)` — one hex nearer than the
// `(2, 0)` it began on. The check reads that back directly: a mote is spawned
// there and `setGrip` is asked for it, which "throws" for "a mote resting anywhere
// but that gripper's hex" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. One `piston` on `(0, 0)` at rotation `0` and rest length `2`,
// with `retract` in cell `0`, and NOTHING else on the field. Length `2` is off
// both bounds, so the cycle under test moves toward `ARM_MIN_LEN` without reaching
// it, and the `overretracted` fault of a piston already at `ARM_MIN_LEN` is a
// different item's.
//
// THE VERDICT. The pose the run reports ends the cycle at length `1`, inside
// `ARM_MIN_LEN` and `ARM_MAX_LEN`, still at rotation `0` and still based on
// `(0, 0)` — and its gripper stands on `(1, 0)`.

import {
  assertBetween,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { afterEach, beforeEach, it } from "vitest";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
import { at, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  heldBy,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The piston's anchor, which a `retract` leaves where it is. */
const BASE: Hex = at(0, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Read back that `part` really carries a gripper on `spoke`, standing on `hex`.
 *
 * `setGrip` "throws" for "a part with no gripper on that spoke" and for "a mote
 * resting anywhere but that gripper's hex" (`specs/instrumentation.md`), so a mote
 * spawned on the hex the anatomy of `specs/parts.md` names and offered to that
 * spoke is a direct reading of where the gripper is. The refusal is caught and
 * reported as the verdict rather than left to escape as the build's own error.
 */
async function gripperStandsOn(
  part: number,
  spoke: number,
  hex: Hex,
  why: string,
): Promise<void> {
  const mote = await spawnMote(h, hex, "dust");
  let refusal: string | null = null;
  try {
    await takeGrip(h, part, spoke, mote);
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  assertNull(refusal, why);
  assertEqual(heldBy(await h.snapshot(), part, spoke), mote, why);
}

it("ends the cycle one length shorter, its base and rotation untouched", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("piston", BASE.q, BASE.r, 0, 2, ["retract"])]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  const before = poseOf(await h.snapshot(), piston);
  assertNotNull(before, "the run reports a live pose for the placed piston");
  assertEqual(
    before?.length,
    2,
    "each run starts every arm at its rest pose, which was placed at length 2",
  );

  await captureReplay(h, "retracted", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "one piston retracting over an empty field faults at nothing",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  const pose = poseOf(after, piston);
  assertNotNull(
    pose,
    "the run reports a live pose for the piston after the cycle",
  );
  assertEqual(pose?.length, 1, "retract lowers the piston's length by one");
  assertBetween(
    pose?.length ?? -1,
    ARM_MIN_LEN,
    ARM_MAX_LEN,
    "a piston's length stays within ARM_MIN_LEN (1) and ARM_MAX_LEN (3)",
  );
  assertEqual(
    pose?.rotation,
    0,
    "retract changes the piston's length alone, so its rotation is unchanged",
  );
  assertEqual(
    `${pose?.cell.q},${pose?.cell.r}`,
    `${BASE.q},${BASE.r}`,
    "retract changes the piston's length alone, so its base is unmoved",
  );

  await gripperStandsOn(
    piston,
    0,
    gripperHex(BASE, 0, 1),
    "the retracted piston's gripper stands one hex nearer along its spoke, on base plus length times DIRS",
  );
});
