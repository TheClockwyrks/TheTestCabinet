// parts/anchor-must-be-on-the-field — an arm's or a wheel's anchor hex must lie
// on the field, and a placement anchored off it is refused.
//
// THE RULE. Placement rule 1: "Every hex of the part is on the field: an arm or
// wheel's anchor, every cell of a track, and every footprint hex of a sigil,
// rise, or set" (`specs/parts.md`, Placement rules). What "on the field" means is
// fixed by `specs/field.md`: "The field is the hexagonal region of radius
// `FIELD_R` around `(0, 0)`: hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`", with `FIELD_R` `5`. The refusal itself is
// `specs/instrumentation.md`, The machine: "Each placement is checked against the
// placement rules of `specs/parts.md` alone, and throws an `Error` naming the
// first rule it breaks."
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live, so
// the only thing the placement rules can be reading is the one part each call
// offers. Four placements are offered on it: an `arm` and a `wheel` anchored on
// `(6, 0)` and `(0, 6)`, whose `max(|q|, |r|, |q + r|)` is `6` and so are OFF the
// field, and the same two anchored on `(5, 0)` and `(0, 5)`, whose figure is `5`
// and so are ON it. The two off-field anchors are one step outside the boundary
// their on-field partners sit on, so nothing but rule 1 separates the pairs.
//
// THE VERDICT. Both off-field placements are refused and add no part, and both
// on-field placements are accepted. The control half is what makes the refusal
// mean rule 1 rather than a surface that refuses everything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FIELD_R } from "../constants";
import { at, onField } from "../field";
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

/** An anchor one step OUTSIDE the field, and one ON its boundary, per axis. */
const OFF_EAST = at(FIELD_R + 1, 0);
const ON_EAST = at(FIELD_R, 0);
const OFF_SOUTH = at(0, FIELD_R + 1);
const ON_SOUTH = at(0, FIELD_R);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses an arm or a wheel anchored off the field and accepts one on it", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing, read off `specs/field.md`'s own
  // formula rather than assumed: two anchors outside the field and two on it.
  assertEqual(
    onField(OFF_EAST),
    false,
    "the east anchor posed is off the field",
  );
  assertEqual(
    onField(OFF_SOUTH),
    false,
    "the south anchor posed is off the field",
  );
  assertEqual(
    onField(ON_EAST),
    true,
    "the east control anchor is on the field",
  );
  assertEqual(
    onField(ON_SOUTH),
    true,
    "the south control anchor is on the field",
  );

  const armOff = await refusesPlacement(() =>
    h.debug.placePart("arm", OFF_EAST.q, OFF_EAST.r, 0),
  );
  const afterArmOff = (await partIds(h)).length;
  const wheelOff = await refusesPlacement(() =>
    h.debug.placePart("wheel", OFF_SOUTH.q, OFF_SOUTH.r, 0),
  );
  const afterWheelOff = (await partIds(h)).length;

  let arm = -1;
  const armOn = await refusesPlacement(async () => {
    arm = await placePart(h, "arm", ON_EAST, 0);
  });
  let wheel = -1;
  const wheelOn = await refusesPlacement(async () => {
    wheel = await placePart(h, "wheel", ON_SOUTH, 0);
  });

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    armOff,
    true,
    `an arm anchored on (${OFF_EAST.q}, ${OFF_EAST.r}) is refused: its anchor is off the field`,
  );
  assertEqual(afterArmOff, 0, "the refused arm added no part to the machine");
  assertEqual(
    wheelOff,
    true,
    `a wheel anchored on (${OFF_SOUTH.q}, ${OFF_SOUTH.r}) is refused: its anchor is off the field`,
  );
  assertEqual(
    afterWheelOff,
    0,
    "the refused wheel added no part to the machine",
  );

  assertEqual(
    armOn,
    false,
    `an arm anchored on (${ON_EAST.q}, ${ON_EAST.r}) is placed: its anchor is on the field`,
  );
  assertEqual(
    wheelOn,
    false,
    `a wheel anchored on (${ON_SOUTH.q}, ${ON_SOUTH.r}) is placed: its anchor is on the field`,
  );

  const snapshot = await h.snapshot();
  assertEqual(
    partById(snapshot, arm)?.kind,
    "arm",
    "the accepted arm stands on the machine",
  );
  assertEqual(
    `${partById(snapshot, arm)?.q},${partById(snapshot, arm)?.r}`,
    `${ON_EAST.q},${ON_EAST.r}`,
    "the accepted arm is anchored where it was placed",
  );
  assertEqual(
    partById(snapshot, wheel)?.kind,
    "wheel",
    "the accepted wheel stands on the machine",
  );
  assertEqual(
    `${partById(snapshot, wheel)?.q},${partById(snapshot, wheel)?.r}`,
    `${ON_SOUTH.q},${ON_SOUTH.r}`,
    "the accepted wheel is anchored where it was placed",
  );
  assertEqual(
    (await partIds(h)).length,
    2,
    "the machine holds the two accepted parts and neither refused one",
  );
});
