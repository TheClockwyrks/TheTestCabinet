// parts/gripper-off-the-field-is-legal — an arm anchored on the field may reach
// its gripper past the boundary.
//
// THE RULE. Placement rule 1 names an ARM'S ANCHOR and nothing else of an arm:
// "Every hex of the part is on the field: an arm or wheel's anchor, every cell of
// a track, and every footprint hex of a sigil, rise, or set" (`specs/parts.md`,
// Placement rules). A gripper is not on that list, and `specs/parts.md` says why
// under Arms: "Only motes collide, so a gripper and the drawn arm between base
// and gripper pass over any hex, on or off the field, and over any part." Where a
// gripper sits is fixed in the same section: "one gripper per spoke at
// `base + length * DIRS[d]`", with the length "a whole number from `ARM_MIN_LEN`
// (`1`) to `ARM_MAX_LEN` (`3`)".
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. One
// `arm` is placed on `(5, 0)`, the field's east boundary, at rotation `0` — which
// `specs/instrumentation.md` gives "at length `ARM_MIN_LEN` (`1`) with an empty
// tape" — and is then grown to `ARM_MAX_LEN` (`3`). Its one spoke points east, so
// its gripper stands on `(8, 0)`, three hexes outside a field of radius `5`.
// Nothing else is on the field, so no other rule has anything to refuse.
//
// THE VERDICT. Both the placement and the growth are taken, the arm stands on
// `(5, 0)` at length `3`, and the gripper that pose puts it at is off the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN, FIELD_R } from "../constants";
import { at, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  type Harness,
} from "../harness";
import { gripperHexes } from "../parts";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(
  place: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** The anchor: the field's east boundary hex. */
const ANCHOR: Hex = at(FIELD_R, 0);

/** The spoke the arm's rotation names: east. */
const ROTATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places an arm at the field's edge whose gripper reaches beyond it", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing: an anchor on the field whose
  // gripper at ARM_MAX_LEN is not.
  assertEqual(onField(ANCHOR), true, "the arm's anchor is on the field");
  const reach = gripperHexes("arm", ANCHOR, ROTATION, ARM_MAX_LEN);
  assertEqual(
    reach.length,
    1,
    "an arm carries one gripper, on the spoke its rotation names",
  );
  const gripper = reach[0] as Hex;
  assertEqual(
    `${gripper.q},${gripper.r}`,
    `${ANCHOR.q + ARM_MAX_LEN},${ANCHOR.r}`,
    "base + length * DIRS[0] puts the gripper three hexes east of the anchor",
  );
  assertEqual(
    onField(gripper),
    false,
    "that gripper hex lies outside the field",
  );

  let arm = -1;
  const refusedPlacement = await refusesPlacement(async () => {
    arm = await placePart(h, "arm", ANCHOR, ROTATION);
  });
  const atRest = partById(await h.snapshot(), arm)?.length;
  const refusedGrowth = await refusesPlacement(() =>
    h.debug.setPartLength(arm, ARM_MAX_LEN),
  );

  await h.advance(1);
  await captureStill(h, "reach");

  assertEqual(
    refusedPlacement,
    false,
    `an arm anchored on (${ANCHOR.q}, ${ANCHOR.r}) is placed: rule 1 names its anchor alone`,
  );
  assertEqual(
    atRest,
    ARM_MIN_LEN,
    "placePart places an arm at ARM_MIN_LEN (1)",
  );
  assertEqual(
    refusedGrowth,
    false,
    `growing that arm to ARM_MAX_LEN (${ARM_MAX_LEN}) is taken, though its gripper then lies off the field`,
  );

  const snapshot = await h.snapshot();
  assertEqual(
    partById(snapshot, arm)?.kind,
    "arm",
    "the arm stands on the machine",
  );
  assertEqual(
    `${partById(snapshot, arm)?.q},${partById(snapshot, arm)?.r}`,
    `${ANCHOR.q},${ANCHOR.r}`,
    "the arm is anchored on the field's boundary hex",
  );
  assertEqual(
    partById(snapshot, arm)?.length,
    ARM_MAX_LEN,
    "the arm stands at ARM_MAX_LEN (3), reaching its gripper off the field",
  );
  assertEqual((await partIds(h)).length, 1, "the arm is the whole machine");
});
