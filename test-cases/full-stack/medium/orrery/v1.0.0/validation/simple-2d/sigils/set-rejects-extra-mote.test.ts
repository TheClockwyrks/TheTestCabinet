// sigils/set-rejects-extra-mote — a constellation carrying one further mote holds
// more than the pattern, and the set refuses it.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly the placed pattern: one mote of the pattern's type on each
// pattern hex, one filament of the pattern's weight for each pattern filament,
// AND NO FURTHER MOTE OR FILAMENT IN THE CONSTELLATION" (`specs/sigils.md`,
// Rises and sets). The last clause is what makes the match exact rather than
// merely sufficient: the pattern may be covered and the constellation still be
// refused, because it carries something the pattern does not.
//
// What counts as "in the constellation" is `specs/field.md`'s: "A constellation
// is a maximal group of motes connected by filaments." So a further mote joined
// to the pattern's motes is part of the same constellation, and it is that
// constellation the set reads.
//
// THE CONFIGURATION. A product of two motes — a `luna` on `(0, 0)` and a `nova`
// on `(1, 0)`, joined by one filament of weight `1` — and its set placed at the
// middle of the field at rotation `0`, so its pattern hexes are exactly those
// two. Nothing else is on the field.
//
// THE VERDICT, in two phases over the one posed world, differing by ONE MOTE:
//
//   1. The pattern exactly — the right type on each pattern hex, one filament of
//      the pattern's weight — plus one further `dust` on the next hex east,
//      joined to the pattern's second mote. Every clause but the last holds. At
//      the boundary the set accepts nothing: the tally stands at `0` and all
//      three motes are still resting where they were posed.
//   2. THE SET IS LIVE. The further mote comes off, and nothing else changes. At
//      the next boundary what is left is exactly the placed pattern, it is
//      consumed, and the tally rises by one — so the refusal was about the extra
//      mote rather than about a set that accepts nothing at all.

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
  constellationOf,
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

const EXACT = challenge({
  name: "Exact Product",
  reagents: [loneMote("luna")],
  products: [PRODUCT],
  permitted: ["arm", "bind"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a constellation that covers the pattern and carries one mote more", async () => {
  await openBareRun(h, {
    challenge: EXACT,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const first = at(ORIGIN.q, ORIGIN.r);
  const second = at(ORIGIN.q + 1, ORIGIN.r);
  const beyond = at(ORIGIN.q + 2, ORIGIN.r);

  // 1. The pattern exactly, plus one further mote joined to it.
  const [luna, nova, extra] = await spawnConstellation(
    h,
    [
      { hex: first, type: "luna" },
      { hex: second, type: "nova" },
      { hex: beyond, type: "dust" },
    ],
    [
      { a: 0, b: 1, weight: 1 },
      { a: 1, b: 2, weight: 1 },
    ],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "extra-mote");

  const oversized = await h.snapshot();
  assertNotNull(oversized.sim, "the run is still live at the first boundary");
  assertEqual(
    constellationOf(oversized, luna ?? -1).length,
    3,
    "the further mote is joined to the pattern's motes, so one constellation holds all three",
  );
  assertEqual(
    tallyOf(oversized, 0),
    0,
    "a constellation carrying a further mote holds more than the pattern, so nothing is accepted",
  );
  assertEqual(
    moteAt(oversized, first)?.id,
    luna,
    "the refused constellation is left resting on the pattern's first hex",
  );
  assertEqual(
    moteAt(oversized, second)?.id,
    nova,
    "the refused constellation is left resting on the pattern's second hex",
  );
  assertEqual(
    moteAt(oversized, beyond)?.id,
    extra,
    "the refused constellation is left resting with its further mote",
  );

  // 2. The further mote comes off.
  await h.debug.removeMote(extra ?? -1);
  await advanceCycles(h, 1);

  const exact = await h.snapshot();
  assertEqual(
    tallyOf(exact, 0),
    1,
    "with nothing further in it the constellation is exactly the placed pattern and is accepted",
  );
  assertNull(
    moteAt(exact, first),
    "an accepted constellation is consumed whole, so the pattern's first hex is bare",
  );
  assertNull(
    moteAt(exact, second),
    "an accepted constellation is consumed whole, so the pattern's second hex is bare",
  );
});
