// parts/rise-and-set-footprints-must-be-on-the-field — a rise or a set whose
// anchor is on the field but whose pattern reaches off it is refused.
//
// THE RULE. Placement rule 1: "Every hex of the part is on the field: an arm or
// wheel's anchor, every cell of a track, and every footprint hex of a sigil,
// rise, or set" (`specs/parts.md`, Placement rules). A rise's and a set's hexes
// are the pattern placed at the pose: "its footprint is its pattern's hexes
// placed at that pose: the molecule pattern for a rise, and for a set the pattern
// plus, when the product repeats, the pattern translated once by the repeat
// vector" (`specs/parts.md`, Rises and sets). The field is
// `max(|q|, |r|, |q + r|) <= FIELD_R` with `FIELD_R` `5` (`specs/field.md`), and
// the surface "throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. A challenge whose one reagent and one product are the same
// three-`dust` line on `(0, 0)`, `(1, 0)`, `(2, 0)`. The rise is offered at
// `(4, 0)` — a hex ON the field, so a build that checked the anchor alone would
// take it — where its pattern reaches `(6, 0)`, off the field; then at `(3, 0)`,
// where all three of its hexes are on. The machine is emptied and the same pair
// of offers is made for the SET, because the rule names both parts and a build
// may compute their footprints in different places.
//
// THE VERDICT. Both edge placements are refused and add no part; both control
// placements are taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, type Hex } from "../field";
import { challenge, link, molecule, mote } from "../formats";
import {
  captureStill,
  clearWorld,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placeRise,
  placeSet,
  type Harness,
} from "../harness";
import { riseFootprint, setFootprint } from "../parts";

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

/** Three `dust` in a line east, joined: a pattern three hexes wide. */
const LINE = molecule(
  [mote(0, 0, "dust"), mote(1, 0, "dust"), mote(2, 0, "dust")],
  [link(at(0, 0), at(1, 0), 1), link(at(1, 0), at(2, 0), 1)],
);

/** A challenge whose reagent and product are both that line. */
const LINES = challenge({
  name: "Lines",
  reagents: [LINE],
  products: [LINE],
  permitted: ["arm"],
});

/** The anchor whose pattern runs off the field, and the one whose does not. */
const OVER_THE_EDGE: Hex = at(4, 0);
const INSIDE: Hex = at(3, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a rise or a set whose pattern reaches outside the field", async () => {
  await openChallengeDocument(h, LINES);

  // The geometry the check claims to be posing.
  assertEqual(
    onField(OVER_THE_EDGE),
    true,
    "the refused anchor is itself on the field",
  );
  assertEqual(
    riseFootprint(LINE, OVER_THE_EDGE, 0).filter((hex) => !onField(hex)).length,
    1,
    "the rise offered at the edge reaches one hex outside the field",
  );
  assertEqual(
    setFootprint(LINE, OVER_THE_EDGE, 0).filter((hex) => !onField(hex)).length,
    1,
    "the set offered at the edge reaches one hex outside the field",
  );
  assertEqual(
    riseFootprint(LINE, INSIDE, 0).filter((hex) => !onField(hex)).length,
    0,
    "every hex of the control rise lies on the field",
  );
  assertEqual(
    setFootprint(LINE, INSIDE, 0).filter((hex) => !onField(hex)).length,
    0,
    "every hex of the control set lies on the field",
  );

  const riseOver = await refusesPlacement(() =>
    h.debug.placeRise(0, OVER_THE_EDGE.q, OVER_THE_EDGE.r, 0),
  );
  const afterRiseOver = (await partIds(h)).length;
  let rise = -1;
  const riseInside = await refusesPlacement(async () => {
    rise = await placeRise(h, 0, INSIDE, 0);
  });
  const riseKind = partById(await h.snapshot(), rise)?.kind;

  await clearWorld(h);

  const setOver = await refusesPlacement(() =>
    h.debug.placeSet(0, OVER_THE_EDGE.q, OVER_THE_EDGE.r, 0),
  );
  const afterSetOver = (await partIds(h)).length;
  let product = -1;
  const setInside = await refusesPlacement(async () => {
    product = await placeSet(h, 0, INSIDE, 0);
  });
  const setKind = partById(await h.snapshot(), product)?.kind;

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    riseOver,
    true,
    `a rise at (${OVER_THE_EDGE.q}, ${OVER_THE_EDGE.r}) is refused: its pattern reaches off the field`,
  );
  assertEqual(
    afterRiseOver,
    0,
    "the refused rise added no part to the machine",
  );
  assertEqual(
    riseInside,
    false,
    `a rise at (${INSIDE.q}, ${INSIDE.r}) is placed: every footprint hex is on the field`,
  );
  assertEqual(riseKind, "rise", "the accepted rise stands on the machine");

  assertEqual(
    setOver,
    true,
    `a set at (${OVER_THE_EDGE.q}, ${OVER_THE_EDGE.r}) is refused: its pattern reaches off the field`,
  );
  assertEqual(afterSetOver, 0, "the refused set added no part to the machine");
  assertEqual(
    setInside,
    false,
    `a set at (${INSIDE.q}, ${INSIDE.r}) is placed: every footprint hex is on the field`,
  );
  assertEqual(setKind, "set", "the accepted set stands on the machine");
});
