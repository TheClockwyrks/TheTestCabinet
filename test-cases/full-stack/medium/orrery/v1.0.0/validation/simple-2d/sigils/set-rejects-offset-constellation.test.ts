// sigils/set-rejects-offset-constellation — the pattern, one hex off the set's
// placed pattern hexes, is not the placed pattern.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly THE PLACED PATTERN: one mote of the pattern's type ON EACH
// PATTERN HEX, one filament of the pattern's weight for each pattern filament,
// and no further mote or filament in the constellation" (`specs/sigils.md`,
// Rises and sets). The pattern the set watches for is the PLACED one, and where
// it is placed is fixed: "A rise or set is placed at an anchor and rotation like
// any sigil, and its footprint is its pattern's hexes placed at that pose"
// (`specs/parts.md`), where placing a pattern is `specs/field.md`'s "each pattern
// coordinate is rotated about `(0, 0)` by the rotation, then translated by the
// anchor". So the hexes are the set's own, and a constellation of the right
// shape somewhere else covers none of them.
//
// THE CONFIGURATION. A product of two motes — a `luna` on `(0, 0)` and a `nova`
// on `(1, 0)`, joined by one filament of weight `1` — and its set placed at the
// middle of the field at rotation `0`, so its pattern hexes are exactly those
// two. Nothing else is on the field: no arm, no other sigil and no rise, so
// nothing but the set can consume anything and nothing can move what is posed.
//
// THE VERDICT, in two phases over the one posed world, differing by WHERE THE
// CONSTELLATION RESTS and by nothing else — the same types, the same shape, the
// same one filament of the same weight:
//
//   1. The pattern posed one hex off, each mote on the neighbor of its pattern
//      hex in direction `1` of `DIRS` (`specs/field.md`). At the boundary the
//      set accepts nothing: the tally stands at `0`, both motes are still
//      resting off the pattern's hexes, and both pattern hexes are bare.
//   2. THE SET IS LIVE. The same shape is posed on the set's own pattern hexes
//      instead. At the next boundary it is consumed and the tally rises by one,
//      so the refusal was about the offset rather than about a set that accepts
//      nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, neighbor } from "../field";
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
  tallyOf,
  type Harness,
} from "../harness";

/** A `luna` on `(0, 0)` and a `nova` on `(1, 0)`, joined by one weight `1` filament. */
const PRODUCT = molecule(
  [mote(0, 0, "luna"), mote(1, 0, "nova")],
  [link(at(0, 0), at(1, 0), 1)],
);

const PLACED = challenge({
  name: "Placed Product",
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

it("refuses the pattern resting one hex off the set's placed pattern hexes", async () => {
  await openBareRun(h, {
    challenge: PLACED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  // The set's placed pattern hexes, and the same two hexes one step off.
  const first = at(ORIGIN.q, ORIGIN.r);
  const second = at(ORIGIN.q + 1, ORIGIN.r);
  const offsetFirst = neighbor(first, 1);
  const offsetSecond = neighbor(second, 1);

  // 1. The pattern, posed one hex off the set's own hexes.
  const [strayLuna, strayNova] = await spawnConstellation(
    h,
    [
      { hex: offsetFirst, type: "luna" },
      { hex: offsetSecond, type: "nova" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "offset");

  const offset = await h.snapshot();
  assertNotNull(offset.sim, "the run is still live at the first boundary");
  assertEqual(
    tallyOf(offset, 0),
    0,
    "a constellation off the set's placed pattern hexes is not the placed pattern, so nothing is accepted",
  );
  assertEqual(
    moteAt(offset, offsetFirst)?.id,
    strayLuna,
    "the refused constellation is left resting where it was posed",
  );
  assertEqual(
    moteAt(offset, offsetSecond)?.id,
    strayNova,
    "the refused constellation is left resting where it was posed",
  );
  assertNull(
    moteAt(offset, first),
    "the set's first pattern hex held nothing while the offset constellation was refused",
  );
  assertNull(
    moteAt(offset, second),
    "the set's second pattern hex held nothing while the offset constellation was refused",
  );

  // 2. The same shape, on the set's own pattern hexes.
  await h.debug.removeMote(strayLuna ?? -1);
  await h.debug.removeMote(strayNova ?? -1);
  await spawnConstellation(
    h,
    [
      { hex: first, type: "luna" },
      { hex: second, type: "nova" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );
  await advanceCycles(h, 1);

  const placed = await h.snapshot();
  assertEqual(
    tallyOf(placed, 0),
    1,
    "on the set's own pattern hexes the same shape is the placed pattern and is accepted",
  );
  assertNull(
    moteAt(placed, first),
    "an accepted constellation is consumed whole, so the pattern's first hex is bare",
  );
  assertNull(
    moteAt(placed, second),
    "an accepted constellation is consumed whole, so the pattern's second hex is bare",
  );
});
