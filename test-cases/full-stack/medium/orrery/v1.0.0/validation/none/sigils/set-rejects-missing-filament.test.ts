// sigils/set-rejects-missing-filament — the pattern's motes on the pattern's
// hexes are not the placed pattern while a pattern filament is missing.
//
// THE RULE. "For a plain product, a constellation is accepted when it is unheld
// and is exactly the placed pattern: one mote of the pattern's type on each
// pattern hex, ONE FILAMENT OF THE PATTERN'S WEIGHT FOR EACH PATTERN FILAMENT,
// and no further mote or filament in the constellation" (`specs/sigils.md`,
// Rises and sets). The clause is about EACH pattern filament, so a pattern
// filament with nothing answering it leaves nothing for the set to accept —
// which `specs/field.md` makes sharper still: "A constellation is a maximal group
// of motes connected by filaments. A lone mote with no filaments is a
// constellation of one." Two unjoined motes are therefore two constellations of
// one, and neither of them is a two-mote pattern.
//
// THE CONFIGURATION. A product of two motes — a `luna` on `(0, 0)` and a `nova`
// on `(1, 0)`, joined by one filament of weight `1` — and its set placed at the
// middle of the field at rotation `0`, so its pattern hexes are exactly those
// two. Nothing else is on the field.
//
// THE VERDICT, in two phases over the one posed world, differing by ONE FILAMENT:
//
//   1. The pattern's own types resting on the pattern's own hexes, with nothing
//      joining them. At the boundary the set accepts nothing: the tally stands
//      at `0` and both motes are still on their hexes.
//   2. THE SET IS LIVE. The one missing filament is made, at the pattern's own
//      weight and between the pattern's own hexes, and nothing else changes. At
//      the next boundary the joined pair is consumed and the tally rises by one,
//      so the refusal was about the missing filament rather than about a set that
//      accepts nothing at all.

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

const JOINED = challenge({
  name: "Joined Product",
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

it("refuses the pattern's motes on the pattern's hexes while a pattern filament is missing", async () => {
  await openBareRun(h, {
    challenge: JOINED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const first = at(ORIGIN.q, ORIGIN.r);
  const second = at(ORIGIN.q + 1, ORIGIN.r);

  // 1. The right types on the right hexes, with the pattern's filament missing.
  const [luna, nova] = await spawnConstellation(h, [
    { hex: first, type: "luna" },
    { hex: second, type: "nova" },
  ]);

  await advanceCycles(h, 1);
  await captureStill(h, "missing");

  const unjoined = await h.snapshot();
  assertNotNull(unjoined.sim, "the run is still live at the first boundary");
  assertEqual(
    tallyOf(unjoined, 0),
    0,
    "a pattern filament with nothing answering it leaves no constellation the set accepts",
  );
  assertEqual(
    constellationOf(unjoined, luna ?? -1).length,
    1,
    "with nothing joining them the first mote is a constellation of one",
  );
  assertEqual(
    constellationOf(unjoined, nova ?? -1).length,
    1,
    "with nothing joining them the second mote is a constellation of one",
  );
  assertEqual(
    moteAt(unjoined, first)?.id,
    luna,
    "the refused motes are left resting on the pattern's first hex",
  );
  assertEqual(
    moteAt(unjoined, second)?.id,
    nova,
    "the refused motes are left resting on the pattern's second hex",
  );

  // 2. The missing filament is made, at the pattern's weight.
  await h.debug.linkMotes(luna ?? -1, nova ?? -1, 1);
  await advanceCycles(h, 1);

  const joined = await h.snapshot();
  assertEqual(
    tallyOf(joined, 0),
    1,
    "with every pattern filament answered the constellation is exactly the placed pattern and is accepted",
  );
  assertNull(
    moteAt(joined, first),
    "an accepted constellation is consumed whole, so the pattern's first hex is bare",
  );
  assertNull(
    moteAt(joined, second),
    "an accepted constellation is consumed whole, so the pattern's second hex is bare",
  );
});
