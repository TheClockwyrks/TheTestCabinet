// sigils/set-repeating-requires-two-copies — one copy of the placed pattern is
// below `REPEAT_MIN`, and a repeating set does not accept it.
//
// THE RULE. "For a repeating product, a constellation is accepted when it is
// unheld and is exactly `k` chained copies of the placed pattern,
// `k >= REPEAT_MIN` (`2`)" (`specs/sigils.md`, Rises and sets). The bound is part
// of the acceptance test, so a single copy — `k` of `1` — is refused however
// exactly it matches the pattern itself, and it is refused by the bound alone
// rather than by anything about its motes, its types or its hexes.
//
// THE CONFIGURATION. The smallest repeating product there is: one `luna` on
// `(0, 0)`, a repeat vector of `(1, 0)`, and a link filament of weight `1`
// joining `(0, 0)` to `(1, 0)`. Its set is placed at the middle of the field at
// rotation `0`, so copy `i` rests on the hex `i` steps east of the anchor.
// Nothing else is on the field, so nothing but the set can take a mote off it.
//
// A ONE-MOTE PATTERN IS THE SHARPEST POSE FOR THIS. The lone `luna` on the set's
// anchor hex is copy `0` in every respect but its count: right type, right hex,
// unheld, unbonded, nothing further in its constellation. What is missing is the
// second copy, and that is exactly what `REPEAT_MIN` asks for.
//
// THE VERDICT, in two phases over the one posed world, differing by ONE COPY:
//
//   1. One copy alone. At the boundary the set accepts nothing: the tally stands
//      at `0` and the `luna` is still resting on the set's anchor hex.
//   2. THE SET IS LIVE. A second copy is posed one repeat vector east and joined
//      to the first by the placed link filament, which brings `k` to
//      `REPEAT_MIN`. At the next boundary the chain is consumed and the tally
//      rises — so the refusal was about the count rather than about a set that
//      accepts nothing at all.

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
  moteAt,
  openBareRun,
  spawnMote,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a single copy, and accepts the chain once a second copy joins it", async () => {
  await openBareRun(h, {
    challenge: CHAINED,
    machine: solution([setPart(0, ORIGIN.q, ORIGIN.r, 0)]),
  });

  const firstHex = at(ORIGIN.q, ORIGIN.r);
  const secondHex = at(ORIGIN.q + 1, ORIGIN.r);

  // 1. One copy alone: k of 1, below REPEAT_MIN.
  const lone = await spawnMote(h, firstHex, "luna");
  await advanceCycles(h, 1);
  await captureStill(h, "single");

  const single = await h.snapshot();
  assertNotNull(single.sim, "the run is still live at the first boundary");
  assertEqual(
    tallyOf(single, 0),
    0,
    "one copy is k of 1, below REPEAT_MIN (2), so nothing is accepted",
  );
  assertEqual(
    moteAt(single, firstHex)?.id,
    lone,
    "the refused copy is left resting on the set's anchor hex",
  );

  // 2. A second copy, one repeat vector east, joined by the placed link filament.
  const second = await spawnMote(h, secondHex, "luna");
  await h.debug.linkMotes(lone, second, 1);

  const paired = await h.snapshot();
  assertLength(
    constellationOf(paired, lone),
    REPEAT_MIN,
    "the second copy brings the chain to exactly REPEAT_MIN chained copies",
  );

  await advanceCycles(h, 1);

  const chained = await h.snapshot();
  assertGreaterThan(
    tallyOf(chained, 0) ?? 0,
    0,
    "at REPEAT_MIN copies the chain is accepted",
  );
  assertNull(
    moteAt(chained, firstHex),
    "an accepted chain is consumed whole, so copy 0's hex is bare",
  );
  assertNull(
    moteAt(chained, secondHex),
    "an accepted chain is consumed whole, so copy 1's hex is bare",
  );
});
