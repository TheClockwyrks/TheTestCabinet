// sigils/binding-wave-before-sets — the binding wave runs BEFORE sets, so a
// `bind` over-joins a would-be chain before the set ever reads it.
//
// THE RULE. "At each boundary, the settle included, sigils act in four waves,
// each wave completing before the next: … 2. The binding sigils: `bind`,
// `manifold`, `triune`. … AFTER THE FOUR WAVES, EVERY SET IS EVALUATED, then
// every rise" (`specs/simulation.md`, The sigil phase). And `bind`'s own effect:
// "When both hexes hold motes and no filament joins that pair, a filament of
// weight `1` is created between them" (`specs/sigils.md`).
//
// What that filament does to the set's reading is the repeating rule's last
// clause: a chain is accepted when it is "exactly `k` chained copies of the
// placed pattern … and the constellation HOLDS NOTHING FURTHER".
//
// THE CONFIGURATION. A repeating product of two `luna`, on `(0, 0)` and
// `(0, 1)`, joined at weight `1`, repeating along `(1, 0)` with a link filament
// from `(0, 0)` to `(1, 0)` at weight `1`. Its set is placed at the middle of the
// field at rotation `0`, so its footprint is the pattern's two hexes plus the
// pattern's two hexes one repeat vector east (`specs/parts.md`).
//
// A `bind` is placed on the pair `(2, 1)`–`(3, 1)`: the SECOND motes of copies
// `2` and `3` of a four-copy chain. Those two hexes lie outside the set's
// footprint, which is what makes the placement legal — "Sigil footprints, rise
// and set footprints included, are pairwise disjoint" (`specs/parts.md`) — and
// the chain does not join that pair, because the placed link filament's
// translates run between the copies' FIRST motes. So the bind's condition holds
// at the boundary and the filament it creates is one the chain does not carry.
//
// The chain posed is FOUR copies, unheld, each internally joined and consecutive
// copies joined by the placed link filament's translates: a constellation the set
// would accept, were the field at the boundary what the check posed.
//
// THE VERDICT, in two phases:
//
//   1. At the boundary the binding wave acts before the set: the filament
//      appears between the two hexes the bind names, and the constellation the
//      set then reads is four copies PLUS one filament more. The set accepts
//      nothing: the tally stands at `0` and all eight motes are still on the
//      field.
//   2. THE SET IS LIVE. Copy `3`'s two motes come off, which takes the bind's
//      new filament with them — "removes that mote and every filament and grip
//      touching it" (`specs/instrumentation.md`) — and empties one of the bind's
//      two hexes, so the bind waits from then on. What is left is a clean
//      three-copy chain, and at the next boundary the same set accepts it and
//      the tally rises. So the refusal was about what the second wave did before
//      the set looked rather than about a set that accepts nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
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
  sigilPart,
  solution,
} from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
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

const BOUND = challenge({
  name: "Bound Chain",
  reagents: [loneMote("luna")],
  products: [PRODUCT],
  permitted: ["arm", "bind"],
});

/** How many copies the chain holds. */
const COPIES = 4;

/** The two hexes copy `i` rests on, `i` repeat vectors east of copy `0`'s. */
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

it("joins two motes of the chain in the second wave, so the set accepts nothing at that boundary", async () => {
  // The bind spans the second motes of copies 2 and 3, clear of the set's
  // footprint and unjoined by the chain.
  const bindFirst = at(ORIGIN.q + 2, ORIGIN.r + 1);

  await openBareRun(h, {
    challenge: BOUND,
    machine: solution([
      setPart(0, ORIGIN.q, ORIGIN.r, 0),
      sigilPart("bind", bindFirst.q, bindFirst.r, 0),
    ]),
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
  const boundA = ids[5] ?? -1;
  const boundB = ids[7] ?? -1;

  // 1. The wave runs, then the set reads what it left.
  await advanceCycles(h, 1);
  await captureStill(h, "bound-chain");

  const bound = await h.snapshot();
  assertNotNull(bound.sim, "the run is still live at the first boundary");
  assertEqual(
    filamentBetween(bound, boundA, boundB)?.weight,
    1,
    "the binding wave runs first, so the bind's weight 1 filament is there when the set reads the chain",
  );
  assertLength(
    constellationOf(bound, ids[0] ?? -1),
    2 * COPIES,
    "binding two motes of one constellation leaves it one constellation of the same eight motes",
  );
  assertEqual(
    tallyOf(bound, 0),
    0,
    "the chain the set reads carries a filament more than its copies, so nothing is accepted",
  );
  for (const pair of hexes) {
    for (const hex of pair) {
      assertNotNull(
        moteAt(bound, hex),
        "the refused chain is left resting on every one of its copies' hexes",
      );
    }
  }

  // 2. Copy 3 comes off, taking the bind's filament and the bind's condition.
  await h.debug.removeMote(ids[6] ?? -1);
  await h.debug.removeMote(ids[7] ?? -1);
  await advanceCycles(h, 1);

  const shortened = await h.snapshot();
  assertGreaterThan(
    tallyOf(shortened, 0) ?? 0,
    0,
    "with the bind silent and a clean three-copy chain left, the same set accepts it",
  );
  for (const i of [0, 1, 2]) {
    for (const hex of copyHexes(i)) {
      assertNull(
        moteAt(shortened, hex),
        "the accepted chain is consumed whole, so every remaining copy's hexes are bare",
      );
    }
  }
});
