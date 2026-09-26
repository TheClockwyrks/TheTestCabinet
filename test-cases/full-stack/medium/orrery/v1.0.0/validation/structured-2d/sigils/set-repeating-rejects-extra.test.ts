// sigils/set-repeating-rejects-extra — a chain carrying one further mote, or one
// further filament, holds more than its copies and is not accepted.
//
// THE RULE. "For a repeating product, a constellation is accepted when it is
// unheld and is exactly `k` chained copies of the placed pattern,
// `k >= REPEAT_MIN` (`2`): copy `i` is the placed pattern translated by `i` times
// the placed repeat vector for `i` from `0` to `k - 1`, consecutive copies are
// joined by the placed link filament and its translates, AND THE CONSTELLATION
// HOLDS NOTHING FURTHER" (`specs/sigils.md`, Rises and sets). The last clause is
// the repeating rule's counterpart of the plain rule's "no further mote or
// filament in the constellation", and it names both: a chain whose copies are all
// correct is refused all the same while it carries anything the copies do not
// account for.
//
// What "in the constellation" reaches is `specs/field.md`'s: "A constellation is
// a maximal group of motes connected by filaments." A mote joined to a chain is
// part of the chain's own constellation, and it is that constellation the set
// reads.
//
// THE CONFIGURATION. A repeating product of two `luna`, on `(0, 0)` and
// `(0, 1)`, joined at weight `1`, repeating along `(1, 0)` with a link filament
// from `(0, 0)` to `(1, 0)` at weight `1`. A two-mote pattern is what makes the
// second half of the rule posable: it leaves the two copies' SECOND motes,
// `(0, 1)` and `(1, 1)`, adjacent to each other and unjoined by the chain, so a
// further filament can be added without moving a mote.
//
// Its set is placed at the middle of the field at rotation `0`. The chain posed
// on it is two copies, correct in every respect: right types, right hexes, joined
// internally and joined to each other by the placed link filament's translate.
// Nothing else is on the field.
//
// THE VERDICT, in three phases over the one posed world, each removing exactly
// what the phase before it added:
//
//   1. ONE FURTHER MOTE. A `dust` two hexes south of the anchor, joined to copy
//      `0`'s second mote — a hex no copy of the pattern reaches. At the boundary
//      the set accepts nothing: the tally stands at `0` and every mote, the
//      further one included, is still resting where it was posed.
//   2. ONE FURTHER FILAMENT. The `dust` comes off, and the two copies' second
//      motes are joined to each other instead — a filament neither copy carries
//      and the placed link's translate does not account for. At the boundary the
//      set again accepts nothing.
//   3. THE SET IS LIVE. That filament is removed, and nothing else changes. At
//      the next boundary the chain — the same four motes, on the same four
//      hexes, joined the same way — is consumed and the tally rises, so both
//      refusals were about what the chain carried rather than about a set that
//      accepts nothing at all.

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
  spawnMote,
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

const EXACT = challenge({
  name: "Exact Chain",
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

it("refuses a correct chain of copies while it carries one further mote or filament", async () => {
  await openBareRun(h, {
    challenge: EXACT,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const headOfFirst = at(ORIGIN.q, ORIGIN.r);
  const tailOfFirst = at(ORIGIN.q, ORIGIN.r + 1);
  const headOfSecond = at(ORIGIN.q + 1, ORIGIN.r);
  const tailOfSecond = at(ORIGIN.q + 1, ORIGIN.r + 1);
  const beyond = at(ORIGIN.q, ORIGIN.r + 2);

  // The two copies, correct in every respect.
  const [firstHead, firstTail, , secondTail] = await spawnConstellation(
    h,
    [
      { hex: headOfFirst, type: "luna" },
      { hex: tailOfFirst, type: "luna" },
      { hex: headOfSecond, type: "luna" },
      { hex: tailOfSecond, type: "luna" },
    ],
    [
      { a: 0, b: 1, weight: 1 },
      { a: 2, b: 3, weight: 1 },
      { a: 0, b: 2, weight: 1 },
    ],
  );

  // 1. One further mote, joined to the chain.
  const extra = await spawnMote(h, beyond, "dust");
  await h.debug.linkMotes(firstTail ?? -1, extra, 1);

  await advanceCycles(h, 1);
  await captureStill(h, "extra");

  const withMote = await h.snapshot();
  assertNotNull(withMote.sim, "the run is still live at the first boundary");
  assertLength(
    constellationOf(withMote, firstHead ?? -1),
    5,
    "the further mote is joined to the chain, so one constellation holds all five motes",
  );
  assertEqual(
    tallyOf(withMote, 0),
    0,
    "a chain carrying a further mote holds something more than its copies, so nothing is accepted",
  );
  assertEqual(
    moteAt(withMote, beyond)?.id,
    extra,
    "the refused chain is left resting with its further mote",
  );
  assertEqual(
    moteAt(withMote, headOfFirst)?.id,
    firstHead,
    "the refused chain is left resting on copy 0's first hex",
  );

  // 2. The further mote comes off, and a further filament goes on.
  await h.debug.removeMote(extra);
  await h.debug.linkMotes(firstTail ?? -1, secondTail ?? -1, 1);
  await advanceCycles(h, 1);

  const withFilament = await h.snapshot();
  assertNotNull(
    filamentBetween(withFilament, firstTail ?? -1, secondTail ?? -1),
    "the further filament is on the field at the boundary that reads it",
  );
  assertEqual(
    tallyOf(withFilament, 0),
    0,
    "a chain carrying a further filament holds something more than its copies either, so nothing is accepted",
  );
  assertLength(
    constellationOf(withFilament, firstHead ?? -1),
    4,
    "the chain is back to its four motes, and it is the filament between two of them that is further",
  );

  // 3. The further filament comes off too.
  await h.debug.unlinkMotes(firstTail ?? -1, secondTail ?? -1);
  await advanceCycles(h, 1);

  const exact = await h.snapshot();
  assertGreaterThan(
    tallyOf(exact, 0) ?? 0,
    0,
    "with nothing further in it the chain is exactly its copies and is accepted",
  );
  for (const hex of [headOfFirst, tailOfFirst, headOfSecond, tailOfSecond]) {
    assertNull(
      moteAt(exact, hex),
      "an accepted chain is consumed whole, so every copy's hexes are bare",
    );
  }
});
