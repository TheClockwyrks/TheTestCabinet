// sigils/sunder-removes-filament — the whole of `sunder`'s effect, on the
// configuration its condition names.
//
// THE RULE, from `specs/sigils.md` (`sunder`): its footprint is `(0, 0)` first and
// `(1, 0)` second, and "When a filament joins the motes on its two hexes, that
// filament is removed, whatever its weight." Removing the one filament joining
// them leaves each mote "a lone mote with no filaments", which `specs/field.md`
// makes "a constellation of one".
//
// THE CONFIGURATION. One `sunder` anchored on `(0, 0)` at rotation `0`, so its
// hexes are `(0, 0)` and `(1, 0)`; one `dust` resting on each; and one filament of
// weight `1` joining them, laid by `linkMotes`, which "Joins motes `a` and `b`
// with one filament of `weight` `1` or `3`" (`specs/instrumentation.md`). Nothing
// else is placed and nothing else is on the field — in particular no `bind`, so
// nothing can lay the filament back at the same boundary.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the two motes
// rest `HEX_PITCH` (`48`) apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. No filament at all after the boundary, and BOTH MOTES STILL RESTING
// ON THEIR HEXES: `sunder` removes a filament, and the review item says what it
// does not do — the motes stay. Each is a constellation of one again.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
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
  constellationOf,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the sunder is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `sunder`'s footprint, placed. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `sunder`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** The weight of the filament the sunder is given to remove. */
const WEIGHT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the weight 1 filament joining the motes on its two hexes", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("sunder", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const first = await spawnMote(h, FIRST, "dust");
  const second = await spawnMote(h, SECOND, "dust");
  await h.debug.linkMotes(first, second, WEIGHT);

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "sunder"),
    "the machine carries the one sunder the check placed",
  );
  assertEqual(
    filamentBetween(before, first, second)?.weight,
    WEIGHT,
    "a filament of weight 1 joins the motes on the sunder's two hexes when the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "sundered");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "sundering a filament halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertNull(
    filamentBetween(snapshot, first, second),
    "the filament joining the motes on the sunder's two hexes is removed at the boundary",
  );
  assertLength(
    sim?.filaments ?? [],
    0,
    "the one filament on the field is gone and no other took its place",
  );
  for (const [mote, hex] of [
    [first, FIRST],
    [second, SECOND],
  ] as const) {
    const found = moteById(snapshot, mote);
    assertNotNull(
      found,
      `the mote on (${hex.q}, ${hex.r}) is still on the field: a sunder removes a filament, not a mote`,
    );
    assertEqual(
      `${found?.q},${found?.r}`,
      `${hex.q},${hex.r}`,
      `the mote on (${hex.q}, ${hex.r}) is still resting on its own hex`,
    );
    assertDeepEqual(
      constellationOf(snapshot, mote),
      [mote],
      `the mote on (${hex.q}, ${hex.r}) is a constellation of one again`,
    );
  }
});
