// sigils/rise-spawns-at-placed-pose — a rotated rise delivers a rotated reagent.
//
// THE RULE. "the reagent appears: one new mote per pattern mote and one filament
// per pattern filament, AT THE PLACED POSE" (`specs/sigils.md`, Rises and sets),
// and "A rise or set is placed at an anchor and rotation like any sigil, and its
// footprint is its pattern's hexes placed at that pose" (`specs/parts.md`). What
// "placed" means is fixed once, for every pattern in the game: "A pattern is
// placed onto the field at an anchor hex and a rotation `0` to `5`: each pattern
// coordinate is rotated about `(0, 0)` by the rotation, using the formulas above,
// then translated by the anchor. Filament endpoints rotate the same way"
// (`specs/field.md`, Molecule patterns), the formulas being
// "Clockwise: `(q, r) -> (-r, q + r)`".
//
// THE CONFIGURATION. An ASYMMETRIC three-mote reagent — three types on three hexes
// — delivered by a rise anchored off the origin at ROTATION `2`. Both halves of the
// placement matter: at rotation `0` the same reagent would land on a different set
// of hexes, and at the origin the anchor would add nothing. The expected hexes are
// computed through `field.ts`'s `place`, which is `specs/field.md`'s formula, so
// nothing here is read off a build.
//
// THE WORLD IS THE RISE. The bare opener clears the field, so every footprint hex
// is vacant, and no other part exists to move what lands.
//
// THE VERDICT. Each pattern entry's type rests on its own rotated, translated hex,
// and the field holds exactly the pattern's motes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, place } from "../field";
import { challenge, link, molecule, mote } from "../formats";
import { ONE_DUST, WEST } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  openBareRun,
  placeRise,
  type Harness,
} from "../harness";

/** Three types on three hexes: a shape no rotation of it maps onto itself. */
const CROOKED = molecule(
  [mote(0, 0, "dust"), mote(1, 0, "nova"), mote(0, 1, "luna")],
  [link(at(0, 0), at(1, 0)), link(at(0, 0), at(0, 1))],
);

/** A challenge whose one reagent is that shape. */
const CROOKED_RISE = challenge({
  name: "Crooked Rise",
  reagents: [CROOKED],
  products: [ONE_DUST],
  permitted: ["arm"],
});

/** The rotation the item names: two sixty-degree steps clockwise. */
const ROTATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays each pattern mote on its coordinate rotated by 2 and translated by the anchor", async () => {
  await openBareRun(h, { challenge: CROOKED_RISE });
  await placeRise(h, 0, WEST, ROTATION);

  await advanceCycles(h, 1);
  await captureStill(h, "rotated");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a rise that delivers raises no fault, so the run is still live",
  );
  for (const entry of CROOKED.motes) {
    const placed = place(at(entry.q, entry.r), WEST, ROTATION);
    const landed = moteAt(after, placed);
    assertNotNull(
      landed,
      `the pattern hex (${entry.q}, ${entry.r}) at the placed pose is (${placed.q}, ${placed.r}), and a mote rests there`,
    );
    assertEqual(
      landed?.type,
      entry.type,
      `the mote on (${placed.q}, ${placed.r}) is the ${entry.type} that pattern hex carries`,
    );
  }
});
