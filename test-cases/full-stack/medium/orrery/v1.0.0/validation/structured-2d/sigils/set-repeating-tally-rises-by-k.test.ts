// sigils/set-repeating-tally-rises-by-k — consuming a chain of `k` copies raises
// that set's tally by `k`, not by one and not by the number of motes.
//
// THE RULE. "An accepted constellation is consumed whole, and THE SET'S TALLY
// RISES BY `1` FOR A PLAIN PRODUCT AND BY `k` FOR A REPEATING ONE"
// (`specs/sigils.md`, Rises and sets), where `k` is the number of chained copies
// the same section defines: "copy `i` is the placed pattern translated by `i`
// times the placed repeat vector for `i` from `0` to `k - 1`". The tallies are
// what the run is measured by — "the tallies decide completion, as
// `specs/simulation.md` defines" — and `sim.tallies` carries "one entry per
// product, in product order" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. A repeating product of TWO `luna`, on `(0, 0)` and
// `(0, 1)`, joined at weight `1`, repeating along `(1, 0)` with a link filament
// from `(0, 0)` to `(1, 0)` at weight `1`. Two motes per copy on purpose: with
// one mote per copy, `k` and the number of motes consumed are the same number,
// and a build that counted motes would be indistinguishable from one that
// counted copies. Here a four-copy chain is EIGHT motes, and the tally the rule
// fixes is `4`.
//
// Its set is placed at the middle of the field at rotation `0`, and the chain
// posed on it is four copies: copy `i` on the hexes `i` steps east of copy `0`'s,
// consecutive copies joined by the placed link filament's translates. Nothing
// else is on the field: no rise to deliver anything, no arm to hold anything,
// and no other sigil to change anything before the set reads it.
//
// THE VERDICT. The tally is read on both sides of the one boundary the chain is
// consumed at, so what is measured is the RISE rather than a figure that happened
// to be right. Before: `0`. After: `4` — the number of copies — while all eight
// motes are gone from the field.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
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
  looseMotes,
  moteAt,
  openBareRun,
  spawnConstellation,
  tallyOf,
  type Harness,
} from "../harness";

/**
 * Two `luna` on `(0, 0)` and `(0, 1)` joined at weight `1`, repeating along
 * `(1, 0)`, consecutive copies joined from `(0, 0)` to `(1, 0)` at weight `1`.
 */
const PRODUCT = molecule(
  [mote(0, 0, "luna"), mote(0, 1, "luna")],
  [link(at(0, 0), at(0, 1), 1)],
  { vector: at(1, 0), link: link(at(0, 0), at(1, 0), 1) },
);

const TALLIED = challenge({
  name: "Tallied Chain",
  reagents: [loneMote("luna")],
  products: [PRODUCT],
  permitted: ["arm", "bind"],
});

/** How many copies this chain holds: the `k` the tally must rise by. */
const COPIES = 4;

/** The hexes copy `i` rests on: the pattern's two hexes, `i` repeat vectors east. */
function copyHexes(i: number) {
  return [at(ORIGIN.q + i, ORIGIN.r), at(ORIGIN.q + i, ORIGIN.r + 1)];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the tally by the number of copies, not by one and not by the number of motes", async () => {
  await openBareRun(h, {
    challenge: TALLIED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const hexes = Array.from({ length: COPIES }, (_unused, i) => copyHexes(i));
  const motes = hexes.flatMap((pair) =>
    pair.map((hex) => ({ hex, type: "luna" as const })),
  );
  const links: { a: number; b: number; weight: number }[] = [];
  for (let i = 0; i < COPIES; i += 1) {
    links.push({ a: 2 * i, b: 2 * i + 1, weight: 1 });
    if (i > 0) links.push({ a: 2 * i - 2, b: 2 * i, weight: 1 });
  }
  const ids = await spawnConstellation(h, motes, links);

  const before = await h.snapshot();
  assertNotNull(
    before.sim,
    "the run is live with the chain posed on the field",
  );
  assertLength(
    constellationOf(before, ids[0] ?? -1),
    2 * COPIES,
    "the four copies are one constellation of eight motes before the boundary",
  );
  assertEqual(
    tallyOf(before, 0),
    0,
    "the tally is read before the boundary, so what the check measures is the rise",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "tally-k");

  const after = await h.snapshot();
  assertEqual(
    tallyOf(after, 0),
    COPIES,
    "a repeating product's tally rises by k, and a four-copy chain is k of 4",
  );
  for (const pair of hexes) {
    for (const hex of pair) {
      assertNull(
        moteAt(after, hex),
        "the accepted chain is consumed whole, so every copy's hexes are bare",
      );
    }
  }
  assertEqual(
    looseMotes(after).length,
    0,
    "all eight motes went, and the tally rose by four rather than by eight",
  );
});
