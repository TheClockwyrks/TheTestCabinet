// sigils/set-rejects-rotated-constellation — the pattern at another rotation is
// not the placed pattern, even about the set's own anchor.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly THE PLACED PATTERN: one mote of the pattern's type ON EACH
// PATTERN HEX, one filament of the pattern's weight for each pattern filament,
// and no further mote or filament in the constellation" (`specs/sigils.md`,
// Rises and sets). A set carries a rotation of its own — "A rise or set is
// placed at an anchor and rotation like any sigil, and its footprint is its
// pattern's hexes placed at that pose" (`specs/parts.md`) — and placing a
// pattern at a pose is `specs/field.md`'s: "each pattern coordinate is rotated
// about `(0, 0)` by the rotation, using the formulas above, then translated by
// the anchor. Filament endpoints rotate the same way." So the set's pattern
// hexes are fixed by the set's OWN rotation, and the same shape turned about the
// same anchor lands on other hexes and is a different thing.
//
// THE CONFIGURATION. A product of two motes — a `luna` on `(0, 0)` and a `nova`
// on `(1, 0)`, joined by one filament of weight `1` — and its set placed at the
// middle of the field at rotation `0`, so its pattern hexes are the anchor and
// the hex east of it. The two types differ on purpose: a pattern of one repeated
// type would read the same at more than one rotation, and there would be nothing
// for a turn to change. Nothing else is on the field.
//
// THE VERDICT, in two phases over the one posed world, differing by ONE
// ROTATION — the same anchor mote, the same types, the same one filament of the
// same weight:
//
//   1. The pattern turned one step about the set's anchor: the `luna` still on
//      the anchor, and the `nova` on the anchor's pattern hex `(1, 0)` rotated
//      one step clockwise, which `specs/field.md`'s `(q, r) -> (-r, q + r)`
//      sends to `(0, 1)`. At the boundary the set accepts nothing: the tally
//      stands at `0`, both motes rest where they were posed, and the set's
//      second pattern hex is bare.
//   2. THE SET IS LIVE. The `nova` is posed on the set's own second pattern hex
//      instead, joined to the same `luna` the same way. At the next boundary the
//      constellation is consumed and the tally rises by one, so the refusal was
//      about the rotation rather than about a set that accepts nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, place } from "../field";
import {
  challenge,
  link,
  loneMote,
  molecule,
  mote,
  setPart,
  solution,
} from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  openBareRun,
  spawnConstellation,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** A `luna` on `(0, 0)` and a `nova` on `(1, 0)`, joined by one weight `1` filament. */
const PRODUCT = molecule(
  [mote(0, 0, "luna"), mote(1, 0, "nova")],
  [link(at(0, 0), at(1, 0), 1)],
);

const ROTATED = challenge({
  name: "Rotated Product",
  reagents: [loneMote("luna")],
  products: [PRODUCT],
  permitted: ["arm"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses the pattern rotated about the set's anchor rather than at the set's own rotation", async () => {
  await openBareRun(h, {
    challenge: ROTATED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  // The set's own pattern hexes, at its own rotation 0, and where the pattern's
  // second hex lands when the pattern is turned one step about the same anchor.
  const anchorHex = place(at(0, 0), ORIGIN, 0);
  const secondHex = place(at(1, 0), ORIGIN, 0);
  const turnedHex = place(at(1, 0), ORIGIN, 1);

  // 1. The pattern turned one step about the set's anchor.
  const [luna, turnedNova] = await spawnConstellation(
    h,
    [
      { hex: anchorHex, type: "luna" },
      { hex: turnedHex, type: "nova" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "rotated");

  const turned = await h.snapshot();
  assertNotNull(turned.sim, "the run is still live at the first boundary");
  assertEqual(
    tallyOf(turned, 0),
    0,
    "the pattern at another rotation is not the placed pattern, so nothing is accepted",
  );
  assertEqual(
    moteAt(turned, anchorHex)?.id,
    luna,
    "the refused constellation is left resting on the set's anchor hex",
  );
  assertEqual(
    moteAt(turned, turnedHex)?.id,
    turnedNova,
    "the refused constellation is left resting on the turned hex",
  );
  assertNull(
    moteAt(turned, secondHex),
    "the set's own second pattern hex is bare while the turned constellation is refused",
  );

  // 2. The same pair, at the set's own rotation.
  await h.debug.removeMote(turnedNova ?? -1);
  const nova = await spawnMote(h, secondHex, "nova");
  await h.debug.linkMotes(luna ?? -1, nova, 1);
  await advanceCycles(h, 1);

  const straight = await h.snapshot();
  assertEqual(
    tallyOf(straight, 0),
    1,
    "at the set's own rotation the same pair is the placed pattern and is accepted",
  );
  assertNull(
    moteAt(straight, anchorHex),
    "an accepted constellation is consumed whole, so the set's anchor hex is bare",
  );
  assertNull(
    moteAt(straight, secondHex),
    "an accepted constellation is consumed whole, so the set's second pattern hex is bare",
  );
});
