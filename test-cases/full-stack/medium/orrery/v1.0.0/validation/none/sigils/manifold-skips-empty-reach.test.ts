// sigils/manifold-skips-empty-reach — an empty reach yields nothing.
//
// THE RULE. `manifold` binds "each reach hex THAT ALSO HOLDS A MOTE"
// (`specs/sigils.md`), and "One filament is created for each reach hex holding a
// mote not already joined to the center." A reach holding nothing holds no mote,
// so it contributes no filament — and none could be created in any case,
// `specs/field.md` making a filament "a rigid link between two motes".
//
// THE CONFIGURATION. One `manifold` anchored on `(0, 0)` at rotation `0`; one
// `dust` on the center; one `dust` on the reach at `(1, 0)` and one on the reach
// at `(0, -1)`; and the reach at `(-1, 1)` LEFT EMPTY. Nothing else is placed and
// nothing else is on the field.
//
// WHY TWO OCCUPIED AND ONE EMPTY. The count is what decides the point: a build
// that creates one filament per reach hex, occupied or not, reports three, and a
// build that gives up on the whole manifold when one reach is empty reports none.
// Only "exactly two" is the rule.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the three motes
// rest `48` and `83.14` apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. Exactly two filaments, center to `(1, 0)` and center to `(0, -1)`,
// both of weight `1`, and `(-1, 1)` still empty.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place, type Hex } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteAt,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the manifold is engraved. */
const ANCHOR = at(0, 0);

/** The `center` hex of `manifold`'s footprint, placed. */
const CENTER = place(at(0, 0), ANCHOR, 0);

/** The two reaches given a mote. */
const OCCUPIED: readonly Hex[] = [at(1, 0), at(0, -1)].map((hex) =>
  place(hex, ANCHOR, 0),
);

/** The reach left empty. */
const EMPTY = place(at(-1, 1), ANCHOR, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one filament per occupied reach and none for the empty one", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("manifold", ANCHOR.q, ANCHOR.r, 0)]),
  });
  const center = await spawnMote(h, CENTER, "dust");
  const reached: number[] = [];
  for (const hex of OCCUPIED) reached.push(await spawnMote(h, hex, "dust"));

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "manifold"),
    "the machine carries the one manifold the check placed",
  );
  assertNull(
    moteAt(before, EMPTY),
    "the third reach holds nothing when the boundary runs",
  );
  assertLength(
    before.sim?.filaments ?? [],
    0,
    "no filament joins any pair when the boundary runs",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "two-reach");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "binding two reaches halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  for (const [index, hex] of OCCUPIED.entries()) {
    assertEqual(
      filamentBetween(snapshot, center, reached[index] ?? -1)?.weight,
      1,
      `the reach at (${hex.q}, ${hex.r}) holds a mote, so it is bound to the center at weight 1`,
    );
  }
  assertLength(
    sim?.filaments ?? [],
    2,
    "two of the three reaches hold motes, so the boundary creates exactly two filaments",
  );
  assertNull(
    moteAt(snapshot, EMPTY),
    "the empty reach is still empty: a manifold spawns nothing",
  );
});
