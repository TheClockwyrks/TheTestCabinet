// sigils/set-rejects-wrong-type — a mote of the wrong type on a pattern hex is
// not the placed pattern, and the set leaves the constellation where it rests.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly the placed pattern: ONE MOTE OF THE PATTERN'S TYPE ON EACH
// PATTERN HEX, one filament of the pattern's weight for each pattern filament,
// and no further mote or filament in the constellation" (`specs/sigils.md`,
// Rises and sets). A mote of some other type on a pattern hex fails that clause,
// so the constellation is not accepted — and "an accepted constellation is
// consumed whole", which an unaccepted one is not.
//
// THE CONFIGURATION. A product of two motes — a `luna` on `(0, 0)` and a `nova`
// on `(1, 0)`, joined by one filament of weight `1` — and its set placed at the
// middle of the field at rotation `0`, so its pattern hexes are exactly those
// two. Nothing else is on the field: no arm, no other sigil, and no rise, so the
// only thing that can consume the constellation is the set, and the only thing
// that can differ from the pattern is what the check puts there.
//
// THE VERDICT, in two phases over the one posed world, differing by ONE MOTE'S
// TYPE:
//
//   1. A `luna` on the first pattern hex and a `meteor` — a type the pattern
//      does not carry at all — on the second, joined by one filament of the
//      pattern's weight. Every other clause of the rule holds. At the boundary
//      the set accepts nothing: the tally stands at `0` and the mistyped
//      constellation is left resting on the field, both motes still on their
//      hexes and still joined.
//   2. THE SET IS LIVE. The `meteor` comes off and a `nova` — the pattern's own
//      type — takes its place on the same hex, joined the same way. At the next
//      boundary that constellation is consumed and the tally rises by one, so
//      the refusal was about the type rather than about a set that accepts
//      nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
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
  filamentBetween,
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

const TYPED = challenge({
  name: "Typed Product",
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

it("leaves a constellation carrying a wrong type on a pattern hex resting on the field", async () => {
  await openBareRun(h, {
    challenge: TYPED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const first = at(ORIGIN.q, ORIGIN.r);
  const second = at(ORIGIN.q + 1, ORIGIN.r);

  // 1. The pattern's shape and filament, with a `meteor` where a `nova` belongs.
  const [luna, meteor] = await spawnConstellation(
    h,
    [
      { hex: first, type: "luna" },
      { hex: second, type: "meteor" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "wrong-type");

  const mistyped = await h.snapshot();
  assertNotNull(mistyped.sim, "the run is still live at the first boundary");
  assertEqual(
    tallyOf(mistyped, 0),
    0,
    "a mote of the wrong type on a pattern hex is not the placed pattern, so nothing is accepted",
  );
  assertEqual(
    moteAt(mistyped, first)?.id,
    luna,
    "the refused constellation is left resting on the pattern's first hex",
  );
  assertEqual(
    moteAt(mistyped, second)?.id,
    meteor,
    "the refused constellation is left resting on the pattern's second hex",
  );
  assertNotNull(
    filamentBetween(mistyped, luna ?? -1, meteor ?? -1),
    "the refused constellation keeps the filament joining its two motes",
  );

  // 2. The pattern's own type takes the same hex, joined the same way.
  await h.debug.removeMote(meteor ?? -1);
  const nova = await spawnMote(h, second, "nova");
  await h.debug.linkMotes(luna ?? -1, nova, 1);
  await advanceCycles(h, 1);

  const typed = await h.snapshot();
  assertEqual(
    tallyOf(typed, 0),
    1,
    "with the pattern's own type on the hex the constellation is exactly the placed pattern and is accepted",
  );
  assertNull(
    moteAt(typed, first),
    "an accepted constellation is consumed whole, so the pattern's first hex is bare",
  );
  assertNull(
    moteAt(typed, second),
    "an accepted constellation is consumed whole, so the pattern's second hex is bare",
  );
});
