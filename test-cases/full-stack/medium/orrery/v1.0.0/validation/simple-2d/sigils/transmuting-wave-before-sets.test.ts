// sigils/transmuting-wave-before-sets — the sigil phase runs BEFORE sets, so a
// `wane` dims a mote of a would-be chain before the set ever reads it.
//
// THE RULE. "At each boundary, the settle included, sigils act in four waves,
// each wave completing before the next: 1. The transmuting sigils: `wane`,
// `mirror`, `ascend`, `conjoin`, `eclipse`, `confluence`, `dispersion`. …
// AFTER THE FOUR WAVES, EVERY SET IS EVALUATED, then every rise"
// (`specs/simulation.md`, The sigil phase). So a set never reads the field as the
// boundary found it: it reads the field the four waves left. And `wane` is the
// first wave's: "An essence mote on the seat becomes `dust`. Its filaments, its
// constellation, and any hold on it are untouched" (`specs/sigils.md`).
//
// THE CONFIGURATION. A repeating product of one `nova` — an essence
// (`specs/field.md` holds `ESSENCES` as `nebula`, `comet`, `nova`, `meteor`) —
// repeating along `(1, 0)`, its copies joined by a link filament of weight `1`.
// Its set is placed at the middle of the field at rotation `0`, so its footprint
// is the anchor and the hex east of it, "the pattern plus, when the product
// repeats, the pattern translated once by the repeat vector"
// (`specs/parts.md`).
//
// A `wane` is placed two hexes east, its seat on the hex copy `2` of a chain
// rests on. That hex is OUTSIDE the set's footprint, which is what makes the
// placement legal at all: "Sigil footprints, rise and set footprints included,
// are pairwise disjoint" (`specs/parts.md`). A chain's copies run on past a
// repeating set's footprint, so the wane's seat can sit on one of them.
//
// The chain posed is THREE copies, unheld, joined by the placed link filament's
// translates: a constellation the set would accept, were the field at the
// boundary what the check posed.
//
// THE VERDICT, in two phases:
//
//   1. At the boundary the `wane` acts first: the `nova` on its seat becomes
//      `dust`, and its filaments and its constellation are untouched — so what
//      the set then reads is a constellation of two `nova` and one `dust`, which
//      is not three copies of a `nova` pattern, and is not two copies either,
//      because it carries the `dust` besides. The set accepts nothing: the tally
//      stands at `0` and all three motes are still on the field.
//   2. THE SET IS LIVE. The dimmed mote is taken off the field, which leaves the
//      wane's seat empty — "a sigil whose condition does not hold at a boundary
//      waits" — and leaves a two-copy chain of `nova` behind it. At the next
//      boundary that chain is accepted and the tally rises, so the refusal was
//      about what the first wave did before the set looked rather than about a
//      set that accepts nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
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
  moteAt,
  openBareRun,
  spawnConstellation,
  tallyOf,
  type Harness,
} from "../harness";

/** One `nova`, repeating east, its copies joined by a weight `1` filament. */
const PRODUCT = molecule([mote(0, 0, "nova")], [], {
  vector: at(1, 0),
  link: link(at(0, 0), at(1, 0), 1),
});

const WANING = challenge({
  name: "Waning Chain",
  reagents: [loneMote("nova")],
  products: [PRODUCT],
  permitted: ["arm", "wane"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("dims a mote of the chain in the first wave, so the set accepts nothing at that boundary", async () => {
  // The wane's seat is the hex copy 2 rests on, two repeat vectors east of the
  // anchor, which is clear of the set's own two footprint hexes.
  const seat = at(ORIGIN.q + 2, ORIGIN.r);

  await openBareRun(h, {
    challenge: WANING,
    machine: solution([
      setPart(0, ORIGIN.q, ORIGIN.r, 0),
      sigilPart("wane", seat.q, seat.r, 0),
    ]),
  });

  const hexes = [at(ORIGIN.q, ORIGIN.r), at(ORIGIN.q + 1, ORIGIN.r), seat];
  const [first, second, third] = await spawnConstellation(
    h,
    hexes.map((hex) => ({ hex, type: "nova" as const })),
    [
      { a: 0, b: 1, weight: 1 },
      { a: 1, b: 2, weight: 1 },
    ],
  );

  // 1. The wave runs, then the set reads what it left.
  await advanceCycles(h, 1);
  await captureStill(h, "waned-chain");

  const waned = await h.snapshot();
  assertNotNull(waned.sim, "the run is still live at the first boundary");
  assertEqual(
    moteAt(waned, seat)?.type,
    "dust",
    "the transmuting wave runs first, so the essence on the wane's seat is dust by the time the set reads it",
  );
  assertEqual(
    moteAt(waned, seat)?.id,
    third,
    "wane transmutes the mote on its seat rather than replacing the constellation's membership",
  );
  assertEqual(
    constellationOf(waned, first ?? -1).length,
    3,
    "wane leaves the filaments and the constellation untouched, so the dimmed mote is still part of the chain",
  );
  assertEqual(
    tallyOf(waned, 0),
    0,
    "the chain the set reads is two nova and a dust, which is not k copies of the pattern, so nothing is accepted",
  );
  assertEqual(
    moteAt(waned, hexes[0] ?? seat)?.id,
    first,
    "the refused chain is left resting on copy 0's hex",
  );
  assertEqual(
    moteAt(waned, hexes[1] ?? seat)?.id,
    second,
    "the refused chain is left resting on copy 1's hex",
  );

  // 2. The dimmed mote comes off, which empties the wane's seat too.
  await h.debug.removeMote(third ?? -1);
  await advanceCycles(h, 1);

  const cleared = await h.snapshot();
  assertGreaterThan(
    tallyOf(cleared, 0) ?? 0,
    0,
    "with the dimmed mote gone the two copies left are a chain the same set accepts",
  );
  assertNull(
    moteAt(cleared, hexes[0] ?? seat),
    "the accepted chain is consumed whole, so copy 0's hex is bare",
  );
  assertNull(
    moteAt(cleared, hexes[1] ?? seat),
    "the accepted chain is consumed whole, so copy 1's hex is bare",
  );
});
