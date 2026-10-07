// sigils/bind-joins-pair — the whole of `bind`'s effect, on the configuration its
// condition names.
//
// THE RULE, from `specs/sigils.md` (`bind`): its footprint is `(0, 0)` first and
// `(1, 0)` second, and "When both hexes hold motes and no filament joins that
// pair, a filament of weight `1` is created between them." `specs/field.md` says
// what a filament is: "A filament is a rigid link between two motes on adjacent
// hexes. It carries a `weight` of `1` or `3`".
//
// THE CONFIGURATION. One `bind` anchored on `(0, 0)` at rotation `0`, so its hexes
// are `(0, 0)` and `(1, 0)`, and one `dust` resting on each. Both are spawned
// through `spawnMote`, which "Adds one unbonded, unheld mote"
// (`specs/instrumentation.md`), so no filament joins the pair when the boundary
// runs, which is the second half of the condition. Nothing else is placed and
// nothing else is on the field, so every filament the run reports afterwards is
// this bind's.
//
// NOTHING MOVES AND NOTHING COLLIDES: the two rest one hex apart, `HEX_PITCH`
// (`48`), above `2 * MOTE_COLLIDE_R` (`38`), and no part on the field carries a
// tape.
//
// THE VERDICT. Exactly one filament, joining exactly those two motes, at weight
// `1`. Both motes are still resting on their own hexes — a bind joins, it does not
// move anything — and they are one constellation afterwards, "a maximal group of
// motes connected by filaments" (`specs/field.md`), where they were two
// constellations of one before.

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

/** Where the bind is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `bind`'s footprint, placed. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `bind`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one weight 1 filament between the motes on its two hexes", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("bind", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const first = await spawnMote(h, FIRST, "dust");
  const second = await spawnMote(h, SECOND, "dust");

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "bind"),
    "the machine carries the one bind the check placed",
  );
  assertLength(
    before.sim?.filaments ?? [],
    0,
    "no filament joins the pair when the boundary runs, which is bind's condition",
  );
  assertDeepEqual(
    constellationOf(before, first),
    [first],
    "before the boundary the mote on the first hex is a constellation of one",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "bound");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "binding a pair halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertEqual(
    filamentBetween(snapshot, first, second)?.weight,
    1,
    "both hexes held motes and no filament joined them, so a filament of weight 1 was created between them",
  );
  assertLength(sim?.filaments ?? [], 1, "one bind, one boundary, one filament");
  assertDeepEqual(
    constellationOf(snapshot, first),
    [first, second].sort((a, b) => a - b),
    "the filament makes the two motes one maximal group",
  );

  for (const [mote, hex] of [
    [first, FIRST],
    [second, SECOND],
  ] as const) {
    const found = moteById(snapshot, mote);
    assertEqual(
      `${found?.q},${found?.r}`,
      `${hex.q},${hex.r}`,
      `the mote on (${hex.q}, ${hex.r}) is still resting on its own hex`,
    );
  }
});
