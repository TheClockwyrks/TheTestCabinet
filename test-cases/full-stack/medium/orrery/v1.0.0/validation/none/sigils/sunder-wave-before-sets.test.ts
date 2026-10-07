// sigils/sunder-wave-before-sets — the sunder wave runs BEFORE sets, so the set
// reads the chain the cut left rather than the chain the boundary found.
//
// THE RULE. "At each boundary, the settle included, sigils act in four waves,
// each wave completing before the next: … 3. `sunder`. … AFTER THE FOUR WAVES,
// EVERY SET IS EVALUATED, then every rise" (`specs/simulation.md`, The sigil
// phase). And `sunder`'s own effect: "When a filament joins the motes on its two
// hexes, that filament is removed, whatever its weight" (`specs/sigils.md`).
//
// Cutting a filament re-draws the constellations, because `specs/field.md` makes
// a constellation "a maximal group of motes connected by filaments": a four-copy
// chain cut between its third and fourth copies is a three-copy chain and a lone
// copy, two constellations where there was one. The set reads those, and the
// repeating rule accepts one of them: "`k` chained copies of the placed pattern,
// `k >= REPEAT_MIN` (`2`)" takes the three and leaves the one, and "the set's
// tally rises … by `k` for a repeating one" makes the rise `3`.
//
// THE CONFIGURATION. A repeating product of one `luna` repeating along `(1, 0)`,
// its copies joined by a link filament of weight `1`. Its set is placed at the
// middle of the field at rotation `0`, so its footprint is the anchor and the
// hex east of it.
//
// A `sunder` is placed on the pair two and three hexes east of the anchor — the
// hexes copies `2` and `3` of a four-copy chain rest on, which the placed link
// filament's translate joins. Both lie outside the set's footprint, which is what
// makes the placement legal: "Sigil footprints, rise and set footprints included,
// are pairwise disjoint" (`specs/parts.md`).
//
// THE VERDICT, read at the ONE boundary that decides the order. This check needs
// no separate control, because the ordering it is about is what makes the set
// accept anything at all here:
//
//   - The tally rises by `3`, not by `4`. Had the set been evaluated before the
//     sunder wave, the whole four-copy chain would have been there to accept and
//     the tally would have risen by `4`.
//   - Copies `0`, `1` and `2` are gone from the field, consumed whole.
//   - Copy `3` is still resting on its hex, unconsumed: it is a chain of one,
//     below `REPEAT_MIN`, and nothing accepts it.

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

const CUT = challenge({
  name: "Cut Chain",
  reagents: [loneMote("luna")],
  products: [PRODUCT],
  permitted: ["arm", "sunder"],
});

/** How many copies the chain holds before the cut. */
const COPIES = 4;

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

it("cuts the link between the third and fourth copies before the set reads the chain", async () => {
  await openBareRun(h, {
    challenge: CUT,
    machine: solution([
      setPart(0, ORIGIN.q, ORIGIN.r, 0),
      // The sunder's two hexes are copy 2's and copy 3's, clear of the set's
      // footprint, and the chain's own link filament joins that pair.
      sigilPart("sunder", copyHex(2).q, copyHex(2).r, 0),
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
  assertNotNull(posed.sim, "the run is live with the four-copy chain posed");
  assertNotNull(
    filamentBetween(posed, ids[2] ?? -1, ids[3] ?? -1),
    "the link the sunder is to cut joins copies 2 and 3 before the boundary",
  );
  assertEqual(
    tallyOf(posed, 0),
    0,
    "the tally is read before the boundary, so what the check measures is the rise",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "cut-chain");

  const cut = await h.snapshot();
  assertEqual(
    tallyOf(cut, 0),
    3,
    "the sunder wave runs before sets, so the set accepts the three copies the cut left and its tally rises by 3",
  );
  for (const i of [0, 1, 2]) {
    assertNull(
      moteAt(cut, copyHex(i)),
      "the three copies the set accepted are consumed whole",
    );
  }
  assertEqual(
    moteAt(cut, copyHex(3))?.id,
    ids[3],
    "the fourth copy the cut left behind is a chain of one, below REPEAT_MIN, so it is still resting on its hex",
  );
  assertEqual(
    constellationOf(cut, ids[3] ?? -1).length,
    1,
    "the cut left the fourth copy joined to nothing",
  );
  assertEqual(
    looseMotes(cut).length,
    1,
    "exactly the three accepted copies went, and the fourth stayed",
  );
});
