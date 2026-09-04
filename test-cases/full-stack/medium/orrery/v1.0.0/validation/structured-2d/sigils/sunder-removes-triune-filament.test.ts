// sigils/sunder-removes-triune-filament — a heavier filament is removed exactly as
// a plain one is.
//
// THE RULE, and the three words that decide this point: `sunder` removes the
// filament joining the motes on its two hexes "WHATEVER ITS WEIGHT"
// (`specs/sigils.md`). `specs/field.md` names the two weights there are — "It
// carries a `weight` of `1` or `3`; a weight of `3` is a triune filament, created
// only as `specs/sigils.md` describes" — so a weight `3` filament is the whole of
// the case the phrase was written for.
//
// THE CONFIGURATION. One `sunder` anchored on `(0, 0)` at rotation `0`, so its
// hexes are `(0, 0)` and `(1, 0)`; a `nova` resting on each, which is the pair a
// triune filament may legitimately join (`specs/sigils.md`, `triune`); and one
// filament of WEIGHT `3` joining them, laid by `linkMotes`
// (`specs/instrumentation.md`). Nothing else is placed and nothing else is on the
// field — in particular no `triune`, so nothing can lay the filament back at the
// same boundary.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the two motes
// rest `HEX_PITCH` (`48`) apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. No filament at all after the boundary, both motes still resting on
// their hexes, each a constellation of one again — the same reading the weight `1`
// case gets. A build that removes only what it recognises as a plain filament
// leaves this one standing.

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

/** The weight of a triune filament. */
const TRIUNE_WEIGHT = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a weight 3 triune filament exactly as it removes a weight 1 one", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("sunder", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const first = await spawnMote(h, FIRST, "nova");
  const second = await spawnMote(h, SECOND, "nova");
  await h.debug.linkMotes(first, second, TRIUNE_WEIGHT);

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "sunder"),
    "the machine carries the one sunder the check placed",
  );
  assertEqual(
    filamentBetween(before, first, second)?.weight,
    TRIUNE_WEIGHT,
    "a triune filament joins the motes on the sunder's two hexes when the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "triune-sundered");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "sundering a filament halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertNull(
    filamentBetween(snapshot, first, second),
    "the filament is removed whatever its weight, and this one's weight was 3",
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
