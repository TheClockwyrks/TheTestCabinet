// runs/bank-seeds-part-hexes — the area bank opens holding every hex of every
// placed part.
//
// THE RULE. "The area bank is a set of hexes accumulated across the run. At the
// start of the run it takes every hex of every placed part, every fixture hex,
// and every gripper hex at rest. A placed part's hexes are an arm or wheel's
// anchor, every cell of a track, and every footprint hex of a sigil, rise, or
// set" (`specs/simulation.md`, Completion and metrics). `sim.area` is what the
// bank reads as: "distinct hexes banked so far"
// (`specs/instrumentation.md`, Snapshot shape).
//
// THE CONFIGURATION IS CHOSEN SO THAT THE PART HEXES ARE THE WHOLE OF THE BANK.
// The rule names three seeds, and this point is about one of them, so the machine
// carries no arm and no wheel: no gripper hexes, and no fixtures. What it does
// carry is one of each SHAPE the rule enumerates — a three-cell `track`, a `bind`
// sigil (whose footprint is two hexes), the `rise` for `BARE`'s reagent, and the
// `set` for its product — placed pairwise disjoint, as placement rules 2 and 3 of
// `specs/parts.md` require them to be. The one mote the settle raises is the
// rise's own reagent, a single `sol` on the rise's single footprint hex, so the
// boundary's own banking of "the hex of every mote" adds nothing that was not
// already there, which the check reads back rather than assumes.
//
// THE EXPECTED FIGURE IS COMPUTED, NOT COUNTED. `parts.ts`'s `partHexes` is
// placement rule 1 written out — "an arm or wheel's anchor, every cell of a
// track, and every footprint hex of a sigil, rise, or set" — so the figure this
// check compares against is the specification's own enumeration over the very
// document that was loaded: three track cells, two `bind` hexes, one rise hex and
// one set hex, seven distinct hexes.
//
// THE VERDICT. `sim.area` is that count, before a single cycle has run. The two
// readings beside it hold the scenario to its shape: no part reports a live pose,
// so nothing on the field has a gripper; and the one mote on the field rests on
// the rise's footprint hex.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertUndefined,
} from "../assert";
import { at, type Hex } from "../field";
import { risePart, setPart, sigilPart, solution, trackPart } from "../formats";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import { captureStill, createHarness, openRun, type Harness } from "../harness";
import { partHexes, type Patterns } from "../parts";

/** A track, a two-hex sigil, a rise and a set: one of every shape the rule names. */
const MACHINE = solution([
  trackPart([at(-2, -2), at(-1, -2), at(0, -2)]),
  sigilPart("bind", ORIGIN.q, ORIGIN.r, 0),
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
]);

/** The molecules a rise's and a set's footprints are drawn from. */
const PATTERNS: Patterns = { reagents: BARE.reagents, products: BARE.products };

/** Placement rule 1's enumeration over this machine, as distinct `"q,r"` keys. */
const PART_HEXES = new Set(
  MACHINE.parts
    .flatMap((part) => partHexes(part, PATTERNS))
    .map((hex: Hex) => `${hex.q},${hex.r}`),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the bank holding every track cell, every sigil hex, and the rise's and set's hexes", async () => {
  await openRun(h, { challenge: BARE, machine: MACHINE });

  const opened = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "seeded");

  assertNotNull(opened.sim, "the run is live once it has been started");
  assertLength(
    opened.sim?.poses ?? [],
    0,
    "the machine holds no arm and no wheel, so no gripper hex and no fixture hex can be in this bank",
  );
  assertUndefined(
    (opened.sim?.motes ?? []).find(
      (mote) => !PART_HEXES.has(`${mote.q},${mote.r}`),
    ),
    "every mote the settle left rests on a hex of a placed part — the rise's reagent on the rise's own footprint hex — so the boundary's own banking of every mote's hex adds nothing new either",
  );

  assertEqual(
    opened.sim?.area,
    PART_HEXES.size,
    "at the start of the run the bank takes every hex of every placed part: every track cell, every footprint hex of a sigil, a rise and a set",
  );
});
