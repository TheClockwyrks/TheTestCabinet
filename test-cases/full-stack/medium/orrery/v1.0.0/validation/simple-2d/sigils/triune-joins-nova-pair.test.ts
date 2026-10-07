// sigils/triune-joins-nova-pair — the whole of `triune`'s effect, on the
// configuration its condition names.
//
// THE RULE, from `specs/sigils.md` (`triune`): its footprint is `(0, 0)` first and
// `(1, 0)` second, and "When both hexes hold `nova` motes and no filament joins
// that pair, a filament of weight `3` is created between them." `specs/field.md`
// says what that weight is: "It carries a `weight` of `1` or `3`; a weight of `3`
// is a triune filament, created only as `specs/sigils.md` describes."
//
// THE CONFIGURATION. One `triune` anchored on `(0, 0)` at rotation `0`, so its
// hexes are `(0, 0)` and `(1, 0)`, and one `nova` resting on each. Both are
// spawned through `spawnMote`, which "Adds one unbonded, unheld mote"
// (`specs/instrumentation.md`), so no filament joins the pair when the boundary
// runs, which is the second half of the condition. Nothing else is placed and
// nothing else is on the field — in particular no `bind`, so a weight `1` filament
// could not arrive from anywhere else.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the two motes
// rest `HEX_PITCH` (`48`) apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. Exactly one filament, joining exactly those two motes, at weight
// `3` — not `1`. Both are still resting on their own hexes and are one
// constellation afterwards.

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

/** Where the triune is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `triune`'s footprint, placed. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `triune`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** The weight a triune filament carries. */
const TRIUNE_WEIGHT = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one weight 3 filament between the two nova on its hexes", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("triune", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const first = await spawnMote(h, FIRST, "nova");
  const second = await spawnMote(h, SECOND, "nova");

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "triune"),
    "the machine carries the one triune the check placed",
  );
  assertLength(
    before.sim?.filaments ?? [],
    0,
    "no filament joins the pair when the boundary runs, which is triune's condition",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "triune-bound");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "joining two nova halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertEqual(
    filamentBetween(snapshot, first, second)?.weight,
    TRIUNE_WEIGHT,
    "both hexes held nova and no filament joined them, so a filament of weight 3 was created between them",
  );
  assertLength(
    sim?.filaments ?? [],
    1,
    "one triune, one boundary, one filament",
  );
  assertDeepEqual(
    constellationOf(snapshot, first),
    [first, second].sort((a, b) => a - b),
    "the triune filament makes the two nova one maximal group",
  );

  for (const [mote, hex] of [
    [first, FIRST],
    [second, SECOND],
  ] as const) {
    const found = moteById(snapshot, mote);
    assertEqual(
      `${found?.q},${found?.r}`,
      `${hex.q},${hex.r}`,
      `the nova on (${hex.q}, ${hex.r}) is still resting on its own hex`,
    );
    assertEqual(
      found?.type,
      "nova",
      `the nova on (${hex.q}, ${hex.r}) is still nova: a triune joins, it transmutes nothing`,
    );
  }
});
