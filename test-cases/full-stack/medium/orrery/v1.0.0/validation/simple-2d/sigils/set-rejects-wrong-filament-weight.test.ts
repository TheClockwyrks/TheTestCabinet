// sigils/set-rejects-wrong-filament-weight — a triune filament where the pattern
// carries a plain one is not the placed pattern, and the set refuses it.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly the placed pattern: one mote of the pattern's type on each
// pattern hex, ONE FILAMENT OF THE PATTERN'S WEIGHT FOR EACH PATTERN FILAMENT,
// and no further mote or filament in the constellation" (`specs/sigils.md`,
// Rises and sets). A filament's weight is part of what a pattern fixes:
// `specs/field.md` gives a filament "a `weight` of `1` or `3`; a weight of `3` is
// a triune filament", and `specs/formats.md` writes the weight into every pattern
// filament. So a weight `3` filament where the pattern's is weight `1` fails the
// clause, however right the motes and the hexes are.
//
// THE CONFIGURATION. A product of two `nova` on `(0, 0)` and `(1, 0)` joined by
// one filament of weight `1`, and its set placed at the middle of the field at
// rotation `0`, so its pattern hexes are exactly those two. Both motes are `nova`
// so that the heavier filament under test is one a machine could really have
// made: `triune` "joins two `nova` motes with a triune filament" of weight `3`
// (`specs/sigils.md`). Nothing else is on the field.
//
// THE VERDICT, in two phases over the one posed world, differing by THE WEIGHT OF
// ONE FILAMENT and nothing else:
//
//   1. The two `nova` on the two pattern hexes, joined by a filament of weight
//      `3`. At the boundary the set accepts nothing: the tally stands at `0`,
//      both motes are still on their hexes, and the filament joining them is
//      still the weight `3` one that was posed.
//   2. THE SET IS LIVE. The same pair, rejoined at the pattern's own weight `1`,
//      is consumed at the next boundary and the tally rises by one — so the
//      refusal was about the weight rather than about a set that accepts nothing
//      at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
import { challenge, loneMote, pair, setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteAt,
  openBareRun,
  spawnConstellation,
  tallyOf,
  type Harness,
} from "../harness";

/** Two `nova` on `(0, 0)` and `(1, 0)`, joined by one filament of weight `1`. */
const PRODUCT = pair("nova", "nova", 1);

const WEIGHED = challenge({
  name: "Weighed Product",
  reagents: [loneMote("nova")],
  products: [PRODUCT],
  permitted: ["arm", "triune"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a weight 3 filament where the pattern's is weight 1", async () => {
  await openBareRun(h, {
    challenge: WEIGHED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const first = at(ORIGIN.q, ORIGIN.r);
  const second = at(ORIGIN.q + 1, ORIGIN.r);

  // 1. The pattern's motes on the pattern's hexes, joined by a TRIUNE filament.
  const [west, east] = await spawnConstellation(
    h,
    [
      { hex: first, type: "nova" },
      { hex: second, type: "nova" },
    ],
    [{ a: 0, b: 1, weight: 3 }],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "wrong-weight");

  const triune = await h.snapshot();
  assertNotNull(triune.sim, "the run is still live at the first boundary");
  assertEqual(
    tallyOf(triune, 0),
    0,
    "a filament of weight 3 is not a filament of the pattern's weight 1, so nothing is accepted",
  );
  assertEqual(
    moteAt(triune, first)?.id,
    west,
    "the refused constellation is left resting on the pattern's first hex",
  );
  assertEqual(
    moteAt(triune, second)?.id,
    east,
    "the refused constellation is left resting on the pattern's second hex",
  );
  assertEqual(
    filamentBetween(triune, west ?? -1, east ?? -1)?.weight,
    3,
    "the refused constellation keeps the weight 3 filament it was posed with",
  );

  // 2. The same pair, rejoined at the pattern's own weight.
  await h.debug.unlinkMotes(west ?? -1, east ?? -1);
  await h.debug.linkMotes(west ?? -1, east ?? -1, 1);
  await advanceCycles(h, 1);

  const plain = await h.snapshot();
  assertEqual(
    tallyOf(plain, 0),
    1,
    "at the pattern's own weight the constellation is exactly the placed pattern and is accepted",
  );
  assertNull(
    moteAt(plain, first),
    "an accepted constellation is consumed whole, so the pattern's first hex is bare",
  );
  assertNull(
    moteAt(plain, second),
    "an accepted constellation is consumed whole, so the pattern's second hex is bare",
  );
});
