// sigils/roles-rotate-with-footprint — a footprint's ROLES turn with it, so which
// hex is the source and which the target follows the rotation.
//
// THE RULE. "Footprints are written as relative hexes at rotation `0`; a placed
// sigil's hexes are its footprint rotated and translated as `specs/field.md`
// describes" (`specs/sigils.md`), and a footprint is written as a table of hexes
// AND ROLES — `mirror`'s is "`(0, 0)` | source" and "`(1, 0)` | target". So the
// role travels with the hex it is written against: the target is wherever the
// footprint's `(1, 0)` landed, not wherever `(1, 0)` happens to be from the
// anchor. The effect is stated in those role names alone: "When the source holds
// an essence and the target holds `dust`, the target becomes that essence."
//
// THE ARITHMETIC. `(1, 0)` turned three clockwise steps by `specs/field.md`'s
// `(q, r) -> (-r, q + r)`: `(1, 0) -> (0, 1) -> (-1, 1) -> (-1, 0)`. Translated to
// the anchor `(0, 0)` that is `(-1, 0)`, "the neighbor west of its source" as
// `DIRS[3]` names it — the review item's own words. The source, the footprint's
// `(0, 0)`, is fixed by rotation and stays on the anchor.
//
// THE CONFIGURATION. One `mirror` anchored on `(0, 0)` at rotation `3`; a `nova`,
// which `specs/field.md` classes an essence, on the source `(0, 0)`; a `dust` on
// the placed target `(-1, 0)`; and a second `dust` on `(1, 0)`, which is where an
// UNROTATED mirror's target would have been. Nothing else is placed and nothing
// else is on the field, and nothing moves.
//
// The three rest `48` and `96` apart, both above `2 * MOTE_COLLIDE_R` (`38`), so
// nothing collides.
//
// THE VERDICT. The `dust` on `(-1, 0)` is `nova` after the boundary, and the
// `dust` on `(1, 0)` is still `dust`. A build that rotated the hexes but kept the
// roles on the compass — target always east of the anchor — copies onto `(1, 0)`
// instead, which this fails in both directions at once.

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
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the mirror is engraved. */
const ANCHOR = at(0, 0);

/** The rotation the review item names. */
const ROTATION = 3;

/** The source: the footprint's `(0, 0)`, which rotation leaves on the anchor. */
const SOURCE = place(at(0, 0), ANCHOR, ROTATION);

/** The target: the footprint's `(1, 0)`, turned three clockwise steps. */
const TARGET = place(at(1, 0), ANCHOR, ROTATION);

/** Where an unrotated mirror's target would have been: the anchor plus `(1, 0)`. */
const UNROTATED = at(1, 0);

/** The essence the source holds, one of the four `ESSENCES` of `specs/field.md`. */
const ESSENCE = "nova";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("copies onto the target its rotated footprint names, west of the source", async () => {
  assertEqual(
    `${TARGET.q},${TARGET.r}`,
    "-1,0",
    "mirror's target hex (1, 0), turned three clockwise steps and translated to the anchor, is the neighbor west of the source",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("mirror", ANCHOR.q, ANCHOR.r, ROTATION)]),
  });
  await spawnMote(h, SOURCE, ESSENCE);
  const target = await spawnMote(h, TARGET, "dust");
  const outsider = await spawnMote(h, UNROTATED, "dust");

  const before = await h.snapshot();
  assertNotNull(
    solePartOfKind(before, "mirror"),
    "the machine carries the one mirror the check placed",
  );
  assertEqual(
    moteById(before, target)?.type,
    "dust",
    "the target holds dust when the boundary runs, which is mirror's condition",
  );

  await advanceCycles(h, 1);
  // The verdict is the state the BOUNDARY left. The frame after it is only
  // what puts the picture on the canvas for the evidence below.
  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "roles");
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(sim?.status, "running", "a mirror acting halts nothing");
  assertNull(sim?.fault ?? null, "no fault is raised: nothing moves");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");

  assertEqual(
    moteById(snapshot, target)?.type,
    ESSENCE,
    "the target is the hex the rotated footprint names, so the dust west of the source became that essence",
  );
  assertEqual(
    moteById(snapshot, outsider)?.type,
    "dust",
    "(1, 0) carries no role at rotation 3, so the dust on it is untouched",
  );
  assertEqual(
    `${moteById(snapshot, outsider)?.q},${moteById(snapshot, outsider)?.r}`,
    `${UNROTATED.q},${UNROTATED.r}`,
    "a mote held by nothing rests on its hex for the whole cycle",
  );
  assertLength(
    sim?.motes ?? [],
    3,
    "the three motes the check spawned are still the only motes on the field",
  );
});
