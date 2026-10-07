// sigils/triune-waits-on-existing-filament — an already joined nova pair is left
// as it is, at the weight it has.
//
// THE RULE. `triune` acts "When both hexes hold `nova` motes AND NO FILAMENT JOINS
// THAT PAIR" (`specs/sigils.md`), and "A sigil whose condition does not hold at a
// boundary waits". `specs/field.md` is why the condition is written that way: "At
// most one filament joins a given pair of motes."
//
// WHY WEIGHT `1` IS THE CASE TO POSE. It is the arrangement a build gets wrong by
// reading its own effect rather than the condition: `triune` creates weight `3`,
// so a build that asks "is this pair joined BY A TRIUNE FILAMENT" rather than "is
// this pair joined" sees a weight `1` filament, decides its condition holds, and
// either lays a second filament over the pair or upgrades the one that is there.
// The rule allows neither: no second filament, and the effect is only ever the
// creation of a new one, so the existing filament keeps its weight.
//
// THE CONFIGURATION. One `triune` anchored on `(0, 0)` at rotation `0`, so its
// hexes are `(0, 0)` and `(1, 0)`; a `nova` on each, so the type half of the
// condition holds; and one filament of weight `1` joining them, laid by
// `linkMotes`, which "Joins motes `a` and `b` with one filament of `weight` `1` or
// `3`" (`specs/instrumentation.md`). Nothing else is placed and nothing else is on
// the field.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the two motes
// rest `HEX_PITCH` (`48`) apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. Still exactly one filament, still joining that pair, still of
// weight `1`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the triune is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `triune`'s footprint, placed. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `triune`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** The weight of the filament that is already there. */
const EXISTING_WEIGHT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds no filament to an already joined nova pair and leaves its weight alone", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("triune", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const first = await spawnMote(h, FIRST, "nova");
  const second = await spawnMote(h, SECOND, "nova");
  await h.debug.linkMotes(first, second, EXISTING_WEIGHT);

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "triune"),
    "the machine carries the one triune the check placed",
  );
  assertEqual(
    filamentBetween(before, first, second)?.weight,
    EXISTING_WEIGHT,
    "a filament of weight 1 joins the pair when the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "already-joined");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "an unsatisfied triune waits, and waiting halts nothing",
  );
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertLength(
    sim?.filaments ?? [],
    1,
    "at most one filament joins a given pair, so the boundary added none",
  );
  assertEqual(
    filamentBetween(snapshot, first, second)?.weight,
    EXISTING_WEIGHT,
    "the filament that was already there keeps the weight it was laid with",
  );
});
