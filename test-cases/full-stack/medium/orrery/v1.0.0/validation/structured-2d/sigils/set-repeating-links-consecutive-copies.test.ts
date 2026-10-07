// sigils/set-repeating-links-consecutive-copies — consecutive copies of an
// accepted chain are joined by the PLACED LINK FILAMENT and its translates.
//
// THE RULE. "For a repeating product, a constellation is accepted when it is
// unheld and is exactly `k` chained copies of the placed pattern,
// `k >= REPEAT_MIN` (`2`): copy `i` is the placed pattern translated by `i` times
// the placed repeat vector for `i` from `0` to `k - 1`, CONSECUTIVE COPIES ARE
// JOINED BY THE PLACED LINK FILAMENT AND ITS TRANSLATES, and the constellation
// holds nothing further" (`specs/sigils.md`, Rises and sets). The link is the
// product's own: `repeat`'s "`link` names the filament joining each copy to the
// next: `a` is a mote hex of the pattern, `b` minus `vector` is a mote hex of the
// pattern", and its "`weight` is `1` or `3` like any filament"
// (`specs/formats.md`). So the join between copy `i` and copy `i + 1` is fixed in
// both respects — WHICH TWO HEXES it runs between, and AT WHAT WEIGHT — and a
// chain joined otherwise is not accepted.
//
// THE CONFIGURATION. A repeating product of two `luna`, on `(0, 0)` and
// `(0, 1)`, joined to each other by a filament of weight `1`; its repeat vector
// is `(1, 0)` and its link filament runs from `(0, 0)` to `(1, 0)` at weight `1`.
// A TWO-mote pattern is what makes this point posable at all: with one mote per
// copy the only adjacent pair between two copies is the link's own, and there is
// no other pair of hexes for a wrong join to run between.
//
// Its set is placed at the middle of the field at rotation `0`, so copy `0`
// rests on the anchor and the hex below it, copy `1` on the two hexes one step
// east of those, and the placed link runs between the two copies' FIRST motes.
// The two copies' SECOND motes, `(0, 1)` and `(1, 1)`, are adjacent to each
// other — their difference is `(1, 0)`, one of `DIRS` (`specs/field.md`) — and
// the chain does not join them. That is the pair a wrong join can run between
// without moving a single mote. Nothing else is on the field.
//
// THE VERDICT, in three phases over the one posed world. The same four motes rest
// on the same four hexes throughout, and each phase differs from the last by one
// filament alone:
//
//   1. THE WRONG HEXES. The two copies are joined between their second motes
//      rather than by the placed link's translate. The constellation is one
//      connected group of four motes covering both copies' hexes exactly, and
//      at the boundary the set accepts nothing.
//   2. THE WRONG WEIGHT. That join is removed and the copies are joined between
//      the placed link's own two hexes instead — at weight `3` rather than the
//      link's weight `1`. At the boundary the set again accepts nothing.
//   3. THE SET IS LIVE. The join is remade at the placed link's own weight, and
//      nothing else changes. At the next boundary the chain is consumed and the
//      tally rises, so both refusals were about the join rather than about a set
//      that accepts nothing at all.

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

const LINKED = challenge({
  name: "Linked Product",
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

it("refuses a chain joined between other hexes, or at another weight", async () => {
  await openBareRun(h, {
    challenge: LINKED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  // Copy 0 on the anchor and the hex below it; copy 1 one repeat vector east.
  const headOfFirst = at(ORIGIN.q, ORIGIN.r);
  const tailOfFirst = at(ORIGIN.q, ORIGIN.r + 1);
  const headOfSecond = at(ORIGIN.q + 1, ORIGIN.r);
  const tailOfSecond = at(ORIGIN.q + 1, ORIGIN.r + 1);

  // 1. The two copies, joined between their SECOND motes.
  const [firstHead, firstTail, secondHead, secondTail] =
    await spawnConstellation(
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
        { a: 1, b: 3, weight: 1 },
      ],
    );

  await advanceCycles(h, 1);
  await captureStill(h, "link");

  const wrongHexes = await h.snapshot();
  assertNotNull(wrongHexes.sim, "the run is still live at the first boundary");
  assertLength(
    constellationOf(wrongHexes, firstHead ?? -1),
    4,
    "the wrongly joined copies are still one connected constellation of four motes",
  );
  assertEqual(
    tallyOf(wrongHexes, 0),
    0,
    "consecutive copies are joined by the placed link filament's translate, so a join between other hexes is not accepted",
  );
  assertEqual(
    moteAt(wrongHexes, headOfFirst)?.id,
    firstHead,
    "the refused chain is left resting on copy 0's first hex",
  );
  assertEqual(
    moteAt(wrongHexes, tailOfSecond)?.id,
    secondTail,
    "the refused chain is left resting on copy 1's second hex",
  );

  // 2. The join moves onto the placed link's own hexes, at the wrong weight.
  await h.debug.unlinkMotes(firstTail ?? -1, secondTail ?? -1);
  await h.debug.linkMotes(firstHead ?? -1, secondHead ?? -1, 3);
  await advanceCycles(h, 1);

  const wrongWeight = await h.snapshot();
  assertEqual(
    tallyOf(wrongWeight, 0),
    0,
    "the placed link filament carries weight 1, so a join of weight 3 is not accepted either",
  );
  assertEqual(
    moteAt(wrongWeight, headOfFirst)?.id,
    firstHead,
    "the refused chain is still resting on copy 0's first hex",
  );

  // 3. The join is remade at the placed link's own weight.
  await h.debug.unlinkMotes(firstHead ?? -1, secondHead ?? -1);
  await h.debug.linkMotes(firstHead ?? -1, secondHead ?? -1, 1);
  await advanceCycles(h, 1);

  const joined = await h.snapshot();
  assertGreaterThan(
    tallyOf(joined, 0) ?? 0,
    0,
    "joined by the placed link filament at its own weight, the chain is accepted",
  );
  for (const hex of [headOfFirst, tailOfFirst, headOfSecond, tailOfSecond]) {
    assertNull(
      moteAt(joined, hex),
      "an accepted chain is consumed whole, so every copy's hexes are bare",
    );
  }
});
