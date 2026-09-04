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
// at rotation `1` therefore puts its copy on the rotated translate, and nothing on
// the hex the unrotated vector names — which is read here in both directions.
//
// AND NOTHING ON THE SECOND TRANSLATE. The hex two repeat vectors out is where the
// third copy of an accepted chain would sit, and it is NOT part of the footprint,
// so a set that drew the chain running off across the field would be showing hexes
// it does not hold.
//
// THE SCENE IS THE EDITOR, WITH NO RUN, so what is on those hexes is the set's own
// drawing rather than a constellation.
//
// THE VERDICT. Both hexes of `setFootprint` — the pattern's own and its one
// translate — are drawn apart from the bare field there, and both the unrotated
// translate and the second translate are untouched.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";

import { at, hexCenter, place, type Hex } from "../field";
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

/** The least share of a square the set must redraw where it shows something. */
const MIN_DISTINCT_SHARE = 0.05;

/** How much of a square the set may redraw where it shows nothing. */
const UNTOUCHED_SHARE = 0.01;

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
  const vector = repeat?.vector as Hex;
  const first = product.motes[0];

  const shown = setFootprint(product, ORIGIN, ROTATION);
  assertEqual(
    shown.length,
    2 * product.motes.length,
    "a repeating product's set footprint is the pattern and one translate of it, which is two hexes for a one-mote pattern",
  );

  /** The hex the copy would sit on if the placed rotation were ignored. */
  const unrotated = place(
    at((first?.q ?? 0) + vector.q, (first?.r ?? 0) + vector.r),
    ORIGIN,
    0,
  );
  /** The hex a THIRD copy of an accepted chain would reach, outside the footprint. */
  const beyond = place(
    at((first?.q ?? 0) + 2 * vector.q, (first?.r ?? 0) + 2 * vector.r),
    ORIGIN,
    ROTATION,
  );

  const bare: PixelRect[] = [];
  for (const hex of shown) bare.push(await square(hex));
  const bareUnrotated = await square(unrotated);
  const bareBeyond = await square(beyond);

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
      MIN_DISTINCT_SHARE,
      `the set draws on (${hex.q}, ${hex.r}), which is one of the two hexes its footprint holds: the placed pattern and its one translate`,
    );
  }

  assertLessThan(
    differingShare(bareUnrotated, await square(unrotated)),
    UNTOUCHED_SHARE,
    `nothing is drawn on (${unrotated.q}, ${unrotated.r}), the hex the repeat vector would reach unrotated, so the copy is drawn at the PLACED repeat vector`,
  );
  assertLessThan(
    differingShare(bareBeyond, await square(beyond)),
    UNTOUCHED_SHARE,
    `nothing is drawn on (${beyond.q}, ${beyond.r}), two repeat vectors out, so what is shown is exactly the set's footprint rather than the whole chain it would accept`,
  );
});
