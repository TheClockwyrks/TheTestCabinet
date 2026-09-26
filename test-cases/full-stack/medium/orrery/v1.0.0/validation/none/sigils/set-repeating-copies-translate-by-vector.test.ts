// sigils/set-repeating-copies-translate-by-vector — the copies of an accepted
// chain march along the PLACED REPEAT VECTOR, and a chain along any other offset
// is not accepted.
//
// THE RULE. "For a repeating product, a constellation is accepted when it is
// unheld and is exactly `k` chained copies of the placed pattern,
// `k >= REPEAT_MIN` (`2`): COPY `i` IS THE PLACED PATTERN TRANSLATED BY `i` TIMES
// THE PLACED REPEAT VECTOR for `i` from `0` to `k - 1`, consecutive copies are
// joined by the placed link filament and its translates, and the constellation
// holds nothing further" (`specs/sigils.md`, Rises and sets). The vector is the
// product's own, written into the document as `repeat`'s "`vector`, a non-zero
// hex offset" (`specs/formats.md`), and it is PLACED with the set, so where copy
// `i` belongs is fixed by the set's pose and the product's vector together and by
// nothing the constellation itself gets to choose.
//
// THE CONFIGURATION. One `luna` on `(0, 0)` repeating along the vector `(1, 0)`,
// its copies joined by a link filament of weight `1` from `(0, 0)` to `(1, 0)`.
// Its set is placed at the middle of the field at rotation `0`, so copy `1`
// belongs on the hex one step EAST of the anchor — direction `0` of `DIRS`
// (`specs/field.md`). Nothing else is on the field.
//
// THE VERDICT, in two phases over the one posed world, differing by WHICH
// NEIGHBOR the second copy rests on and by nothing else — the same two `luna`,
// the same one filament of the same weight, joined the same way, and adjacent
// either way:
//
//   1. Two copies marching along direction `1` of `DIRS` instead: the first on
//      the set's anchor, the second on the hex southeast of it. Every clause but
//      the vector holds. At the boundary the set accepts nothing: the tally
//      stands at `0`, both motes are still resting where they were posed, and
//      the hex one repeat vector east of the anchor is bare.
//   2. THE SET IS LIVE. The second copy is posed one repeat vector east instead,
//      joined to the first the same way. At the next boundary the chain is
//      consumed and the tally rises, so the refusal was about the offset the
//      copies marched along rather than about a set that accepts nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
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
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** One `luna`, repeating along `(1, 0)`, its copies joined by a weight `1` filament. */
const PRODUCT = molecule([mote(0, 0, "luna")], [], {
  vector: at(1, 0),
  link: link(at(0, 0), at(1, 0), 1),
});

const CHAINED = challenge({
  name: "Chained Product",
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

it("refuses a chain whose copies march along an offset that is not the placed repeat vector", async () => {
  await openBareRun(h, {
    challenge: CHAINED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const anchorHex = at(ORIGIN.q, ORIGIN.r);
  // Where copy 1 belongs: the anchor plus one placed repeat vector, which is
  // the neighbor in direction 0. Where this chain puts it instead: direction 1.
  const onVector = neighbor(anchorHex, 0);
  const offVector = neighbor(anchorHex, 1);

  // 1. Two copies marching along the wrong offset.
  const [head, stray] = await spawnConstellation(
    h,
    [
      { hex: anchorHex, type: "luna" },
      { hex: offVector, type: "luna" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "vector");

  const wrongWay = await h.snapshot();
  assertNotNull(wrongWay.sim, "the run is still live at the first boundary");
  assertEqual(
    tallyOf(wrongWay, 0),
    0,
    "copy 1 is the pattern translated by the placed repeat vector, so a chain along another offset is not accepted",
  );
  assertEqual(
    moteAt(wrongWay, anchorHex)?.id,
    head,
    "the refused chain is left resting on the set's anchor hex",
  );
  assertEqual(
    moteAt(wrongWay, offVector)?.id,
    stray,
    "the refused chain is left resting where its second copy was posed",
  );
  assertNull(
    moteAt(wrongWay, onVector),
    "nothing rests one repeat vector east while the chain marches the other way",
  );

  // 2. The second copy, one placed repeat vector east.
  await h.debug.removeMote(stray ?? -1);
  const onward = await spawnMote(h, onVector, "luna");
  await h.debug.linkMotes(head ?? -1, onward, 1);
  await advanceCycles(h, 1);

  const rightWay = await h.snapshot();
  assertGreaterThan(
    tallyOf(rightWay, 0) ?? 0,
    0,
    "along the placed repeat vector the same two copies are a chain and are accepted",
  );
  assertNull(
    moteAt(rightWay, anchorHex),
    "an accepted chain is consumed whole, so copy 0's hex is bare",
  );
  assertNull(
    moteAt(rightWay, onVector),
    "an accepted chain is consumed whole, so copy 1's hex is bare",
  );
});
