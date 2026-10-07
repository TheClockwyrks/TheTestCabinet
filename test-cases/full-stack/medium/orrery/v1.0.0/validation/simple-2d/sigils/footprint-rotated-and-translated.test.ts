// sigils/footprint-rotated-and-translated — where a placed sigil's hexes are.
//
// THE RULE. "Footprints are written as relative hexes at rotation `0`; a placed
// sigil's hexes are its footprint rotated and translated as `specs/field.md`
// describes" (`specs/sigils.md`). `specs/field.md` describes it once, under
// Molecule patterns: "each pattern coordinate is rotated about `(0, 0)` by the
// rotation, using the formulas above, then translated by the anchor", and the
// formula above it is the clockwise one, "`(q, r) -> (-r, q + r)`".
//
// THE ARITHMETIC, done here rather than trusted. `bind`'s footprint is `(0, 0)`
// first and `(1, 0)` second. At rotation `2`, `(1, 0)` turns twice clockwise:
// `(1, 0) -> (0, 1) -> (-1, 1)`. Anchored on `(0, 0)`, the translation adds
// nothing, so the placed hexes are `(0, 0)` and `(-1, 1)` — exactly the pair the
// review item names. `(1, 0)`, which is where an UNROTATED bind's second hex would
// have been, is not one of them.
//
// THE CONFIGURATION. One `bind` anchored on `(0, 0)` at rotation `2`, and three
// `dust` motes: one on `(0, 0)`, one on `(-1, 1)`, and one on `(1, 0)`. Nothing
// else is placed and nothing else is on the field, and nothing moves — every part
// on the field is the sigil, and a sigil has no tape — so every filament the run
// reports afterwards was created by this bind at this boundary.
//
// THE THREE ARE PAIRWISE CLEAR OF THE COLLISION THRESHOLD at rest: adjacent hex
// centers are `HEX_PITCH` (`48`) apart and `(-1, 1)` to `(1, 0)` is `83.14`, both
// above `2 * MOTE_COLLIDE_R` (`38`), and nothing moves to bring them nearer.
//
// THE VERDICT. Exactly one filament, joining the motes on `(0, 0)` and `(-1, 1)`,
// at weight `1` — "a filament of weight `1` is created between them"
// (`specs/sigils.md`, `bind`). The mote on `(1, 0)` is joined to neither: a build
// that placed the footprint without rotating it binds `(0, 0)` to `(1, 0)`
// instead, and a build that rotated counterclockwise binds `(0, 0)` to `(1, -1)`,
// where there is nothing at all.

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
  captureStill,
  createHarness,
  advanceCycles,
  filamentBetween,
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the bind is engraved. */
const ANCHOR = at(0, 0);

/** The rotation the review item names. */
const ROTATION = 2;

/** The first hex: the footprint's `(0, 0)`, which rotation leaves alone. */
const FIRST = place(at(0, 0), ANCHOR, ROTATION);

/** The second hex: the footprint's `(1, 0)`, turned twice clockwise. */
const SECOND = place(at(1, 0), ANCHOR, ROTATION);

/** Where an unrotated bind's second hex would have been. */
const UNROTATED = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("binds the pair its rotated footprint names and leaves the unrotated hex alone", async () => {
  assertEqual(
    `${SECOND.q},${SECOND.r}`,
    "-1,1",
    "bind's (1, 0) rotated twice clockwise about (0, 0) and translated to the anchor is (-1, 1)",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("bind", ANCHOR.q, ANCHOR.r, ROTATION)]),
  });
  const first = await spawnMote(h, FIRST, "dust");
  const second = await spawnMote(h, SECOND, "dust");
  const outsider = await spawnMote(h, UNROTATED, "dust");

  const before = await h.snapshot();
  assertLength(
    before.sim?.filaments ?? [],
    0,
    "no filament joins any pair before the boundary runs",
  );
  assertNotNull(
    solePartOfKind(before, "bind"),
    "the machine carries the one bind the check placed",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "rotated");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "binding a pair halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertEqual(
    filamentBetween(snapshot, first, second)?.weight,
    1,
    "the rotated footprint's two hexes both held motes, so the boundary joined them at weight 1",
  );
  assertNull(
    filamentBetween(snapshot, first, outsider),
    "(1, 0) is not one of this bind's hexes at rotation 2, so nothing joins it to the anchor",
  );
  assertNull(
    filamentBetween(snapshot, second, outsider),
    "(1, 0) is not one of this bind's hexes at rotation 2, so nothing joins it to (-1, 1)",
  );
  assertLength(
    sim?.filaments ?? [],
    1,
    "one bind with both hexes occupied creates exactly one filament",
  );

  for (const [mote, hex] of [
    [first, FIRST],
    [second, SECOND],
    [outsider, UNROTATED],
  ] as const) {
    const found = moteById(snapshot, mote);
    assertEqual(
      `${found?.q},${found?.r}`,
      `${hex.q},${hex.r}`,
      `the mote on (${hex.q}, ${hex.r}) is held by nothing and rests on its hex for the whole cycle`,
    );
  }
});
