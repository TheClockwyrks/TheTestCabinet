// sigils/sets-before-rises — every set is evaluated before any rise spawns, so a
// hex a set clears is vacant for a rise at the same boundary.
//
// THE RULE. "After the four waves, EVERY SET IS EVALUATED, THEN EVERY RISE, each
// in the same reading order. A SET CONSUMES EVERY CONSTELLATION IT ACCEPTS BEFORE
// ANY RISE SPAWNS" (`specs/simulation.md`, The sigil phase). What a rise then
// finds is fixed by its own condition: "When every footprint hex is vacant, the
// reagent appears: one new mote per pattern mote and one filament per pattern
// filament, at the placed pose, unheld" (`specs/sigils.md`), where
// `specs/sigils.md`'s terms make vacant "the hex holds neither a mote nor a
// fixture". So a rise whose footprint hex was occupied at the start of the
// boundary still delivers, provided a set emptied it first.
//
// THE CONFIGURATION. A repeating product of one `luna` repeating along `(1, 0)`,
// its copies joined by a link filament of weight `1`, and a reagent of one
// `luna`. The set is placed at the middle of the field at rotation `0`, so its
// footprint is the anchor and the hex east of it; the rise is placed two hexes
// east, so its footprint is that one hex alone. The two footprints are disjoint,
// as "Sigil footprints, rise and set footprints included, are pairwise disjoint"
// (`specs/parts.md`) requires — and a repeating set's chain runs on past its own
// footprint, which is how a copy comes to rest on the rise's hex at all.
//
// A three-copy chain is posed, unheld: copies `0` and `1` on the set's own
// footprint hexes and copy `2` on the RISE's footprint hex. At the boundary the
// rise's hex holds a mote, so a rise evaluated first would find it occupied and
// wait.
//
// THE VERDICT, read at the ONE boundary the order decides:
//
//   - The set accepted the chain: the tally rose by three and copies `0` and `1`
//     are gone from their hexes.
//   - The rise delivered at the SAME boundary: a `luna` rests on the rise's
//     footprint hex, and its id is not one of the three the chain was posed
//     with — so it is a new mote the rise spawned, not the copy that was there.
//     Had the rise been evaluated before the set, its hex would have been
//     occupied and it would have waited, leaving that hex bare.
//   - The delivered mote is unheld, as the rise's own sentence requires.

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
  risePart,
  setPart,
  solution,
} from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
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

const DELIVERING = challenge({
  name: "Delivering Chain",
  reagents: [loneMote("luna")],
  products: [PRODUCT],
  permitted: ["arm"],
});

/** How many copies the chain holds. */
const COPIES = 3;

/** Where copy `i` rests: the set's anchor plus `i` placed repeat vectors. */
function copyHex(i: number) {
  return at(ORIGIN.q + i, ORIGIN.r);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the rise's footprint hex by consuming the chain, and the rise delivers at the same boundary", async () => {
  // The rise stands on the hex copy 2 of the chain rests on, clear of the set's
  // own two footprint hexes.
  const riseHex = copyHex(2);

  await openBareRun(h, {
    challenge: DELIVERING,
    machine: solution([
      setPart(0, ORIGIN.q, ORIGIN.r, 0),
      risePart(0, riseHex.q, riseHex.r, 0),
    ]),
  });

  const ids = await spawnConstellation(
    h,
    Array.from({ length: COPIES }, (_unused, i) => ({
      hex: copyHex(i),
      type: "luna" as const,
    })),
    Array.from({ length: COPIES - 1 }, (_unused, i) => ({
      a: i,
      b: i + 1,
      weight: 1,
    })),
  );

  const posed = await h.snapshot();
  assertNotNull(posed.sim, "the run is live with the three-copy chain posed");
  assertEqual(
    moteAt(posed, riseHex)?.id,
    ids[2],
    "the rise's footprint hex is occupied by the chain's last copy when the boundary begins",
  );
  assertEqual(
    tallyOf(posed, 0),
    0,
    "the tally is read before the boundary, so what the check measures is the rise",
  );

  await captureReplay(h, "cleared", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertEqual(
    tallyOf(after, 0),
    COPIES,
    "the set accepted the three-copy chain, so its tally rose by three",
  );
  assertNull(
    moteAt(after, copyHex(0)),
    "the accepted chain is consumed whole, so copy 0's hex is bare",
  );
  assertNull(
    moteAt(after, copyHex(1)),
    "the accepted chain is consumed whole, so copy 1's hex is bare",
  );

  const delivered = moteAt(after, riseHex);
  assertNotNull(
    delivered,
    "the set consumed the chain before any rise spawned, so the rise found its footprint hex vacant and delivered",
  );
  assertEqual(
    delivered?.type,
    "luna",
    "what the rise delivered is its reagent's one mote",
  );
  assertEqual(
    ids.includes(delivered?.id ?? -1),
    false,
    "the mote on the rise's hex is a new one the rise spawned rather than the copy that was standing there",
  );
  assertLength(
    after.sim?.grips ?? [],
    0,
    "the reagent appears unheld, and nothing on this field holds anything",
  );
});
