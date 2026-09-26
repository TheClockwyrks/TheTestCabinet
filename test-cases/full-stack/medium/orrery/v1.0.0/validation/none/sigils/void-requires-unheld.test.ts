// sigils/void-requires-unheld — a gripper saves a mote from the maw.
//
// THE RULE. "An unbonded, UNHELD mote on the maw is consumed" (`specs/sigils.md`,
// The void), where "unheld: no gripper holds any mote of the mote's
// constellation", and "A sigil whose condition does not hold at a boundary waits".
// So a mote on the maw whose constellation a gripper holds survives the boundary.
//
// THE CONFIGURATION. One `void` on the middle of the field, one `dust` on its maw,
// and one length 1 `arm` reaching onto that maw. An arm carries "one gripper per
// spoke at `base + length * DIRS[d]`" and "The part's rotation names its first
// spoke" (`specs/parts.md`), so an arm anchored one hex east of the maw at rotation
// `3` — `DIRS[3]` is `(-1, 0)`, toward the west (`specs/field.md`) — grips it. That
// anchor is a rim hex, which "An arm or wheel's anchor may sit on any sigil
// footprint hex" (`specs/parts.md`) permits. The arm's tape is empty, "which every
// part rests on", and the hold is given with `setGrip`, "which takes hold with no
// `grab` ever running" (`specs/instrumentation.md`), so the only cycle that runs is
// the one under test.
//
// THE VERDICT, IN BOTH DIRECTIONS. At the held boundary the mote is still on the
// maw and the gripper still holds it. Then the gripper alone is opened and one
// further boundary runs: the same mote on the same maw is consumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import type { SigilName } from "../constants";
import { at, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { sigilRoleHex } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  heldBy,
  holdGrip,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** One named hex of a placed sigil, from the footprint tables of `specs/sigils.md`. */
function roleHex(
  kind: SigilName,
  role: string,
  anchor: Hex,
  rotation: number,
): Hex {
  const hex = sigilRoleHex(kind, role, anchor, rotation);
  if (hex === null) {
    throw new Error(`Orrery: specs/sigils.md gives ${kind} no ${role} hex`);
  }
  return hex;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a mote on the maw alone while a gripper holds it", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "void", ORIGIN, 0);
  const maw = roleHex("void", "maw", ORIGIN, 0);

  const held = await spawnMote(h, maw, "dust");
  const arm = await placePart(h, "arm", at(maw.q + 1, maw.r), 3);
  await takeGrip(h, arm, 3, held);
  assertEqual(
    heldBy(await h.snapshot(), arm, 3),
    held,
    "the arm's one gripper holds the mote on the maw",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "held");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a sigil whose condition does not hold waits: nothing faults",
  );
  assertEqual(
    moteAt(after, maw)?.id,
    held,
    "a mote resting on the maw whose constellation a gripper holds is not consumed",
  );
  assertEqual(
    heldBy(after, arm, 3),
    held,
    "the gripper that saved the mote still holds it",
  );
  assertLength(
    after.sim?.motes ?? [],
    1,
    "the held mote is still the whole of the field",
  );

  // The hold is the only thing that changes, and the maw then consumes.
  await holdGrip(h, arm, 3);
  await advanceCycles(h, 1);

  assertNull(
    moteById(await h.snapshot(), held),
    "the same mote on the same maw is consumed once no gripper holds it",
  );
});
