// parts/sigil-footprint-must-be-on-the-field — a sigil whose ANCHOR is on the
// field but one of whose footprint hexes is not is refused.
//
// THE RULE. Placement rule 1: "Every hex of the part is on the field: an arm or
// wheel's anchor, every cell of a track, and every footprint hex of a sigil,
// rise, or set" (`specs/parts.md`, Placement rules). A sigil's hexes are its
// tabulated footprint placed at its pose: "Footprints are written as relative
// hexes at rotation `0`; a placed sigil's hexes are its footprint rotated and
// translated as `specs/field.md` describes" (`specs/sigils.md`). `confluence`'s
// footprint is `(0, 0)` the crown and the four founts `(1, 0)`, `(0, 1)`,
// `(-1, 0)`, `(0, -1)`. The field is `max(|q|, |r|, |q + r|) <= FIELD_R` with
// `FIELD_R` `5` (`specs/field.md`), and the surface "throws an `Error` naming the
// first rule it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. A
// `confluence` is offered at `(5, 0)` — a hex ON the field, so a build that
// checked the anchor alone would take it — and its founts reach `(6, 0)` and
// `(5, 1)`, both off. The same sigil is then offered one hex west at `(4, 0)`,
// where every one of its five hexes lies on the field. The anchor is the only
// thing that moved between the two.
//
// THE VERDICT. The confluence at `(5, 0)` is refused and adds no part; the one at
// `(4, 0)` is placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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
import { sigilHexes } from "../parts";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(place: () => Promise<unknown>): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** The anchor whose confluence reaches off the field, and the one whose does not. */
const OVER_THE_EDGE: Hex = at(5, 0);
const INSIDE: Hex = at(4, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a confluence whose anchor is on the field and whose founts are not", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing, from `specs/sigils.md`'s
  // footprint and `specs/field.md`'s extent.
  const over = sigilHexes("confluence", OVER_THE_EDGE, 0);
  const inside = sigilHexes("confluence", INSIDE, 0);
  assertEqual(onField(OVER_THE_EDGE), true, "the refused sigil's own anchor is on the field");
  assertEqual(
    over.filter((hex) => !onField(hex)).length,
    2,
    "two of that confluence's five hexes fall outside the field",
  );
  assertEqual(
    inside.filter((hex) => !onField(hex)).length,
    0,
    "every hex of the control confluence lies on the field",
  );

  const refusedOver = await refusesPlacement(() =>
    h.debug.placePart("confluence", OVER_THE_EDGE.q, OVER_THE_EDGE.r, 0),
  );
  const afterRefusal = (await partIds(h)).length;

  let sigil = -1;
  const refusedInside = await refusesPlacement(async () => {
    sigil = await placePart(h, "confluence", INSIDE, 0);
  });

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    refusedOver,
    true,
    `a confluence at (${OVER_THE_EDGE.q}, ${OVER_THE_EDGE.r}) is refused: two footprint hexes are off the field`,
  );
  assertEqual(afterRefusal, 0, "the refused confluence added no part to the machine");
  assertEqual(
    refusedInside,
    false,
    `a confluence at (${INSIDE.q}, ${INSIDE.r}) is placed: every footprint hex is on the field`,
  );
  assertEqual(
    partById(await h.snapshot(), sigil)?.kind,
    "confluence",
    "the accepted confluence stands on the machine",
  );
});
