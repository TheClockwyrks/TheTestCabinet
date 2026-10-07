// sigils/bind-waits-on-existing-filament — a pair that is already joined is left
// as it is, whatever the weight of the filament joining it.
//
// THE RULE. `bind` acts "When both hexes hold motes AND NO FILAMENT JOINS THAT
// PAIR" (`specs/sigils.md`), and "A sigil whose condition does not hold at a
// boundary waits". `specs/field.md` is why the condition is written that way: "At
// most one filament joins a given pair of motes." So a bind over an already joined
// pair creates nothing, and the pair keeps the one filament it has.
//
// THE TWO CASES. The review item names both weights a filament may carry —
// `specs/field.md`: "It carries a `weight` of `1` or `3`; a weight of `3` is a
// triune filament" — because a build that recognised only its own weight `1`
// filaments would double-join a triune pair. Each case is posed on its own bare
// run, so neither can leave anything behind for the other.
//
// THE CONFIGURATION, in each case. One `bind` anchored on `(0, 0)` at rotation
// `0`, so its hexes are `(0, 0)` and `(1, 0)`; two `nova` motes, one on each,
// joined by `linkMotes`, which "Joins motes `a` and `b` with one filament of
// `weight` `1` or `3`" (`specs/instrumentation.md`). `nova` in both cases so the
// weight `3` case is a pair a triune filament may legitimately join
// (`specs/sigils.md`, `triune`), and nothing but a `bind` is on the field, so the
// filament that is there at the end is the one the check laid.
//
// THE VERDICT. After the boundary the run still reports exactly one filament, it
// still joins that pair, and its weight is the weight the check gave it. A build
// that binds a joined pair reports two.

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

/** Where the bind is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `bind`'s footprint, placed. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `bind`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** The two weights `specs/field.md` lets a filament carry. */
const WEIGHTS: readonly number[] = [1, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no second filament over a pair already joined, at weight 1 or 3", async () => {
  for (const weight of WEIGHTS) {
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([sigilPart("bind", ANCHOR.q, ANCHOR.r, 0)]),
    });
    const first = await spawnMote(h, FIRST, "nova");
    const second = await spawnMote(h, SECOND, "nova");
    await h.debug.linkMotes(first, second, weight);

    const before = await h.snapshot();
    assertNotNull(
      solePartOfKind(before, "bind"),
      `weight ${weight}: the machine carries the one bind the check placed`,
    );
    assertLength(
      before.sim?.filaments ?? [],
      1,
      `weight ${weight}: the pair is joined before the boundary runs`,
    );

    await advanceCycles(h, 1);
    // The verdict is the state the BOUNDARY left. The frame after it is only
    // what puts the picture on the canvas for the evidence below.
    const snapshot = await h.snapshot();
    await h.advance(1);
    await captureStill(h, "unchanged");
    const sim = snapshot.sim;
    assertNotNull(sim, `weight ${weight}: the run is live through the cycle`);
    assertEqual(
      sim?.status,
      "running",
      `weight ${weight}: an unsatisfied bind waits, and waiting halts nothing`,
    );
    assertNull(
      sim?.fault ?? null,
      `weight ${weight}: no fault is raised: nothing moves`,
    );
    assertEqual(
      sim?.cycle,
      1,
      `weight ${weight}: the cycle reached its boundary`,
    );
    assertLength(
      sim?.filaments ?? [],
      1,
      `weight ${weight}: at most one filament joins a given pair, so the boundary added none`,
    );
    assertEqual(
      filamentBetween(snapshot, first, second)?.weight,
      weight,
      `weight ${weight}: the filament that was already there is untouched`,
    );
  }
});
