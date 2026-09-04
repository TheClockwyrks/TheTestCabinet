// parts/each-rise-is-placed-at-most-once — one rise per reagent, however far the
// second is offered from the first.
//
// THE RULE. Placement rule 5: "Each rise and each set is placed at most once"
// (`specs/parts.md`, Placement rules). A rise is identified by which reagent it
// delivers: "`rise`, `set` — `q`, `r`, `rotation`, and `index`: which reagent or
// product, from `0`" (`specs/formats.md`, Solutions), and "The tray derives one
// `rise` per reagent" (`specs/formats.md`, Challenges). `specs/editor.md` states
// the same from the tray's side: "A rise or set entry is spent once its part is on
// the field ... a press on it does nothing until the placed part is deleted." The
// surface "throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. A challenge with TWO one-mote reagents, so a second rise
// exists to be placed legally and the refusal below cannot be "no second rise may
// stand at all". On an empty machine with no run live, the rise for reagent `0`
// is placed at `(-3, 0)`. The rise for reagent `0` is then offered again at
// `(3, 0)` and at `(0, 3)` — hexes no footprint reaches, so rules 1 and 2 hold
// for both — and finally the rise for reagent `1` is offered at `(3, 0)`.
//
// THE VERDICT. Both second offers of reagent `0`'s rise are refused and add no
// part; reagent `1`'s rise is placed on one of the very hexes reagent `0`'s was
// refused on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, type Hex } from "../field";
import { challenge, molecule, mote } from "../formats";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placeRise,
  type Harness,
} from "../harness";

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

/** Two one-mote reagents, so two rises exist and only one of each may stand. */
const TWO_REAGENTS = challenge({
  name: "Two Reagents",
  reagents: [molecule([mote(0, 0, "dust")]), molecule([mote(0, 0, "nova")])],
  products: [molecule([mote(0, 0, "dust")])],
  permitted: ["arm"],
});

const FIRST: Hex = at(-3, 0);
const FAR: Hex = at(3, 0);
const FARTHER: Hex = at(0, 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a second rise for a reagent already on the field", async () => {
  await openChallengeDocument(h, TWO_REAGENTS);
  for (const hex of [FIRST, FAR, FARTHER]) {
    assertEqual(onField(hex), true, `the hex (${hex.q}, ${hex.r}) is on the field`);
  }

  const rise = await placeRise(h, 0, FIRST, 0);

  const againFar = await refusesPlacement(() =>
    h.debug.placeRise(0, FAR.q, FAR.r, 0),
  );
  const afterFar = (await partIds(h)).length;
  const againFarther = await refusesPlacement(() =>
    h.debug.placeRise(0, FARTHER.q, FARTHER.r, 0),
  );
  const afterFarther = (await partIds(h)).length;

  let other = -1;
  const otherRefused = await refusesPlacement(async () => {
    other = await placeRise(h, 1, FAR, 0);
  });

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    againFar,
    true,
    `a second rise for reagent 0 at (${FAR.q}, ${FAR.r}) is refused`,
  );
  assertEqual(afterFar, 1, "that refusal added no part");
  assertEqual(
    againFarther,
    true,
    `a second rise for reagent 0 at (${FARTHER.q}, ${FARTHER.r}) is refused too, however far away it is offered`,
  );
  assertEqual(afterFarther, 1, "that refusal added no part either");
  assertEqual(
    otherRefused,
    false,
    "the rise for the OTHER reagent is placed on the very hex reagent 0's was refused on",
  );

  const snapshot = await h.snapshot();
  assertEqual(partById(snapshot, rise)?.index, 0, "the standing rise is reagent 0's");
  assertEqual(partById(snapshot, other)?.index, 1, "the second rise is reagent 1's");
  assertEqual(
    (await partIds(h)).length,
    2,
    "the machine holds one rise per reagent and nothing more",
  );
});
