// presentation/repeating-set-shows-its-repeated-copy — a repeating set draws the
// placed pattern and one translate of it, which is exactly its footprint.
//
// THE RULE. "A rise shows its reagent's pattern and a set shows its product's
// pattern" (`specs/parts.md`, Presentation), and for a repeating product that file
// says what the pattern shown is: the footprint is "the pattern plus, when the
// product repeats, the pattern translated once by the repeat vector".
//
// WHY ONE TRANSLATE AND NOT MORE. What the set accepts is a chain of any length
// from `REPEAT_MIN` (`2`) up — "exactly `k` chained copies of the placed pattern,
// `k >= REPEAT_MIN` (`2`): copy `i` is the placed pattern translated by `i` times
// the placed repeat vector" (`specs/sigils.md`) — but its FOOTPRINT is the first
// two copies alone, and the footprint is what is engraved on the field. So the
// chain a player reads off the field is the pattern and one copy: enough to read
// which way the chain runs, and no more than the hexes the set actually holds.
//
// THE POSE IS ROTATED ON PURPOSE. The repeat vector is a pattern offset, so it
// rotates with the pattern (`specs/field.md`: "each pattern coordinate is rotated
// about `(0, 0)` by the rotation ... then translated by the anchor"). A set placed
// at rotation `1` therefore puts its copy on the ROTATED translate, which is the
// hex read for the copy — a build that ignored the rotation draws its copy
// somewhere else and leaves that hex bare.
//
// THE SCENE IS THE EDITOR, WITH NO RUN, so what is on those hexes is the set's own
// drawing rather than a constellation.
//
// WHAT THIS POINT DOES NOT DECIDE. How many hexes the footprint holds is
// `parts/repeating-set-footprint-adds-one-translate`'s, read off the placement
// rules rather than off the picture. Nor is the hex the UNROTATED vector names
// read for being bare: it neighbours the footprint, so the edge of what the set
// draws next to it reaches the square, and the only way to pass it would be a
// tolerance `specs/` does not fix.
//
// THE VERDICT. Both hexes of `setFootprint` — the pattern's own and its one
// translate — are drawn apart from the bare field there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertGreaterThan } from "../assert";

import { hexCenter, type Hex } from "../field";
import { ORIGIN, REPEATING, REPEATING_LUNA } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openChallengeDocument,
  partById,
  placeSet,
  type Harness,
  type PixelRect,
} from "../harness";
import { setFootprint } from "../parts";

/** The rotation the set is placed at, so the repeat vector is really turned. */
const ROTATION = 1;

/** Half the side of the square a hex is read over; inside its own cell. */
const HALF = 18;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function square(hex: Hex): Promise<PixelRect> {
  const centre = hexCenter(hex);
  return h.pixelRect(centre.x - HALF, centre.y - HALF, 2 * HALF, 2 * HALF);
}

it("draws a repeating set's pattern and the one copy at its placed repeat vector", async () => {
  // `REPEATING`'s one product is a single `luna` repeating east, so its footprint
  // is two hexes and every hex read here is one the specification names.
  await openChallengeDocument(h, REPEATING);
  await h.advance(1);

  const product = REPEATING_LUNA;
  const repeat = product.repeat;
  assertDefined(
    repeat,
    "the product repeats, which is what gives its set a footprint of the pattern plus one translate",
  );
  const shown = setFootprint(product, ORIGIN, ROTATION);
  assertEqual(
    shown.length,
    2 * product.motes.length,
    "a repeating product's set footprint is the pattern and one translate of it, which is two hexes for a one-mote pattern",
  );

  const bare: PixelRect[] = [];
  for (const hex of shown) bare.push(await square(hex));

  const set = await placeSet(h, 0, ORIGIN, ROTATION);
  // The editor outlines the selected part's footprint (`specs/editor.md`), which
  // would mark the footprint hexes for a reason that is not the shown chain.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "repeat");

  assertEqual(
    partById(await h.snapshot(), set)?.rotation,
    ROTATION,
    "the set really stands at the rotation its chain is read against",
  );

  for (const [index, hex] of shown.entries()) {
    assertGreaterThan(
      differingShare(bare[index] as PixelRect, await square(hex)),
      0,
      `the set draws on (${hex.q}, ${hex.r}), which is one of the two hexes its footprint holds: the placed pattern and its one translate`,
    );
  }
});
