// sigils/set-repeating-accepts-chain — a repeating product's set accepts a chain
// of copies and consumes the whole of it.
//
// THE RULE. "For a repeating product, a constellation is accepted when it is
// unheld and is exactly `k` chained copies of the placed pattern,
// `k >= REPEAT_MIN` (`2`): copy `i` is the placed pattern translated by `i` times
// the placed repeat vector for `i` from `0` to `k - 1`, consecutive copies are
// joined by the placed link filament and its translates, and the constellation
// holds nothing further" (`specs/sigils.md`, Rises and sets). And what happens
// then is the same sentence as for a plain product: "An accepted constellation is
// consumed WHOLE."
//
// THE CONFIGURATION. The smallest repeating product there is: one `luna` on
// `(0, 0)`, a repeat vector of `(1, 0)`, and a link filament of weight `1`
// joining `(0, 0)` to `(1, 0)` — the shape `specs/formats.md` writes as a
// molecule with a `repeat`. Its set is placed at the middle of the field at
// rotation `0`, so copy `i` of an accepted chain rests on the hex `i` steps east
// of the set's anchor. Nothing else is on the field: no arm, no other sigil and
// no rise, so the only thing that can take a mote off the field is the set.
//
// THE VERDICT, in two phases, at the two lengths the rule's bound distinguishes:
//
//   1. A chain of exactly `REPEAT_MIN` (`2`) copies — the shortest chain the
//      rule accepts — resting unheld on the field, its two copies joined by the
//      placed link filament. At the boundary both motes are gone and the tally
//      has risen, so the chain was ACCEPTED rather than merely lost.
//   2. A chain of THREE copies, longer than the bound. At the next boundary the
//      WHOLE chain is gone — all three copies, not the two the shortest chain
//      would have taken — and the tally has risen again.
//
// Why the tally is read at all: a set that quietly dropped motes and a set that
// accepted them are the same picture on the field, and "the set's tally rises by
// `1` for a plain product and by `k` for a repeating one" is what tells them
// apart. How far it rises is a different point; that it rose is this one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { REPEAT_MIN } from "../constants";
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

/** One `luna`, repeating east, its copies joined by a weight `1` filament. */
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

/** Where copy `i` of the placed pattern rests: the anchor plus `i` repeat vectors. */
function copyHex(i: number) {
  return at(ORIGIN.q + i, ORIGIN.r);
}

/** A chain of `copies` copies, joined by the placed link filament and its translates. */
function poseChain(h: Harness, copies: number): Promise<number[]> {
  return spawnConstellation(
    h,
    Array.from({ length: copies }, (_unused, i) => ({
      hex: copyHex(i),
      type: "luna" as const,
    })),
    Array.from({ length: copies - 1 }, (_unused, i) => ({
      a: i,
      b: i + 1,
      weight: 1,
    })),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a chain of copies and consumes the whole of it", async () => {
  await openBareRun(h, {
    challenge: CHAINED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  // 1. The shortest chain the rule accepts: REPEAT_MIN copies.
  const shortest = await poseChain(h, REPEAT_MIN);
  const posed = await h.snapshot();
  assertNotNull(posed.sim, "the run is live with the chain posed on the field");
  assertLength(
    constellationOf(posed, shortest[0] ?? -1),
    REPEAT_MIN,
    "the copies were posed joined, so they are one constellation before the boundary",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "chain");

  const consumedShortest = await h.snapshot();
  assertGreaterThan(
    tallyOf(consumedShortest, 0) ?? 0,
    0,
    "a chain of REPEAT_MIN copies is accepted, and an accepted constellation raises the tally",
  );
  for (let i = 0; i < REPEAT_MIN; i += 1) {
    assertNull(
      moteAt(consumedShortest, copyHex(i)),
      "an accepted chain is consumed whole, so every copy's hex is bare",
    );
  }

  // 2. A longer chain, to show the WHOLE of it goes rather than the first two.
  const before = tallyOf(consumedShortest, 0) ?? 0;
  await poseChain(h, 3);
  await advanceCycles(h, 1);

  const consumedLonger = await h.snapshot();
  assertGreaterThan(
    tallyOf(consumedLonger, 0) ?? 0,
    before,
    "a chain longer than REPEAT_MIN is accepted too, and the tally rises again",
  );
  for (let i = 0; i < 3; i += 1) {
    assertNull(
      moteAt(consumedLonger, copyHex(i)),
      "the whole chain is consumed, not the first REPEAT_MIN copies of it",
    );
  }
  assertEqual(
    looseMotes(consumedLonger).length,
    0,
    "nothing of the chain is left on the field after it is consumed",
  );
});
