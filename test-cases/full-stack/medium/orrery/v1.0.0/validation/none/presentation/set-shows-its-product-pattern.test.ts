// presentation/set-shows-its-product-pattern — a placed set draws the product it
// is waiting for, at the pose it was placed at.
//
// THE RULE. "A rise shows its reagent's pattern and a set shows its product's
// pattern" (`specs/parts.md`, Presentation); `specs/assets.md` puts "The reagent
// pattern a rise shows and the product pattern a set shows" under "What stays
// drawn in code".
//
// WHAT THERE IS TO SHOW. "A `set` receives one product ... its footprint is its
// pattern's hexes placed at that pose" (`specs/parts.md`), and what it will take is
// exactly that shape: "a constellation is accepted when it is unheld and is exactly
// the placed pattern: one mote of the pattern's type on each pattern hex, one
// filament of the pattern's weight for each pattern filament"
// (`specs/sigils.md`). So the motes AND the filaments of the pattern are what a
// player has to read to know what to build and where to leave it.
//
// THE POSE IS ROTATED ON PURPOSE. "each pattern coordinate is rotated about
// `(0, 0)` by the rotation ... then translated by the anchor. Filament endpoints
// rotate the same way" (`specs/field.md`), and the set rejects a constellation that
// is not at that pose — "set-rejects-rotated-constellation". A set placed at
// rotation `2` therefore shows its second mote on the rotated hex and nothing on
// the hex the unrotated pattern names, which is read here in both directions.
//
// WHERE THE FILAMENT IS READ. `specs/assets.md` draws a strip "centered on the
// midpoint between the two motes' centers"; two adjacent centres are `HEX_PITCH`
// (`48`) apart and `MOTE_R` (`22`) bounds a mote's paint, so the square about that
// midpoint is where a shown filament lands and neither mote's art reaches.
//
// THE SCENE IS THE EDITOR, WITH NO RUN, so nothing has spawned and what is on
// those hexes is the set's own drawing.
//
// THE VERDICT. Every hex of the placed set's footprint, and the midpoint of the
// pattern's one filament, is drawn apart from the bare field there; the hex the
// pattern would have reached unrotated is untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { at, hexCenter, place, type Hex, type StagePoint } from "../field";
import { ORIGIN, PAIRED, TWO_LUNA } from "../fixtures";
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

/** The rotation the set is placed at, so the pattern is really turned. */
const ROTATION = 2;

/** Half the side of the square a hex is read over; inside its own cell. */
const HALF = 18;

/** Half the side of the square a filament is read over. */
const LINK_HALF = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function square(point: StagePoint, half: number): Promise<PixelRect> {
  return h.pixelRect(point.x - half, point.y - half, 2 * half, 2 * half);
}

function midpointOf(a: Hex, b: Hex): StagePoint {
  const from = hexCenter(a);
  const to = hexCenter(b);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

it("draws the product's motes and filament at the set's placed anchor and rotation", async () => {
  // `PAIRED`'s one product is two `luna` joined by a plain filament, which is the
  // smallest product with a hex a rotation moves and a filament to show.
  await openChallengeDocument(h, PAIRED);
  await h.advance(1);

  const product = TWO_LUNA;
  const shown = setFootprint(product, ORIGIN, ROTATION);
  const filament = product.filaments[0];
  assertEqual(
    shown.length,
    product.motes.length,
    "a plain product's set footprint is its pattern placed at its pose, so there is one hex to read per pattern mote",
  );

  const link = midpointOf(
    place(filament?.a as Hex, ORIGIN, ROTATION),
    place(filament?.b as Hex, ORIGIN, ROTATION),
  );
  const unrotated = place(
    at(product.motes[1]?.q ?? 0, product.motes[1]?.r ?? 0),
    ORIGIN,
    0,
  );

  const bare: PixelRect[] = [];
  for (const hex of shown) bare.push(await square(hexCenter(hex), HALF));
  const bareLink = await square(link, LINK_HALF);
  const bareUnrotated = await square(hexCenter(unrotated), HALF);

  const set = await placeSet(h, 0, ORIGIN, ROTATION);
  // The editor outlines the selected part's footprint (`specs/editor.md`), which
  // would mark the hexes this point reads for a reason that is not the pattern.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "set");

  const placed = partById(await h.snapshot(), set);
  assertEqual(
    placed?.rotation,
    ROTATION,
    "the set really stands at the rotation its pattern is read against",
  );
  assertEqual(
    placed?.index,
    0,
    "the set is the one for product 0, whose pattern is the one read here",
  );

  for (const [index, hex] of shown.entries()) {
    assertGreaterThan(
      differingShare(
        bare[index] as PixelRect,
        await square(hexCenter(hex), HALF),
      ),
      0,
      `the set draws its product's mote on (${hex.q}, ${hex.r}), which is where the placed anchor and rotation put it`,
    );
  }

  assertGreaterThan(
    differingShare(bareLink, await square(link, LINK_HALF)),
    0,
    "the set draws the filament of its product's pattern between the two motes it is waiting for",
  );

  assertEqual(
    differingShare(bareUnrotated, await square(hexCenter(unrotated), HALF)),
    0,
    `nothing is drawn on (${unrotated.q}, ${unrotated.r}), the hex the pattern would reach unrotated, so the pattern is shown at the pose the set was placed at`,
  );
});
