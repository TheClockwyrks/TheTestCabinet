// field/pattern-rotates-one-clockwise-step — rotation `1` is one 60 degree
// clockwise step, and it happens before the translation.
//
// THE RULE, from `specs/field.md` (Directions and rotation): "Rotating an offset
// `(q, r)` by one 60 degree step about `(0, 0)`: Clockwise: `(q, r) -> (-r, q +
// r)`", and (Molecule patterns) "each pattern coordinate is rotated about `(0, 0)`
// by the rotation, using the formulas above, then translated by the anchor." So a
// pattern coordinate of `(1, 0)` at rotation `1` becomes `(-0, 1 + 0)` = `(0, 1)`
// before the anchor is added — and `specs/field.md`'s direction table makes
// `(0, +1)` the offset "Toward" SOUTHEAST, so the mote lands one hex southeast of
// the anchor.
//
// WHERE IT BECOMES OBSERVABLE. `specs/sigils.md` (`rise`): "When every footprint
// hex is vacant, the reagent appears: one new mote per pattern mote and one
// filament per pattern filament, at the placed pose, unheld", the rises running
// "After the four waves" of each boundary (`specs/simulation.md`, The sigil phase).
//
// THE CONFIGURATION IS THE SAME PATTERN AND THE SAME ANCHOR AS ROTATION `0`, so
// the rotation is the only thing that changed: one `nova` on the pattern
// coordinate `(1, 0)`, and a rise for it anchored on `(2, -1)` — at rotation `1`.
// The mote lands on `(2, -1) + (0, 1)` = `(2, 0)`, which is a different hex from
// the `(3, -1)` rotation `0` puts it on, so a build that ignores the rotation
// fails here and a build that rotates about the anchor's neighbour rather than
// about `(0, 0)` before translating does too.
//
// THE WORLD IS EMPTY AROUND IT. The bare opener resets, poses the challenge, loads
// the one rise, holds the completion switch off, starts the run and empties the
// field. The machine moves nothing and the field is bare, so the one mote read
// back is the one the rise put there.
//
// THE VERDICT. Exactly one mote is on the field after the boundary, it is the
// pattern's `nova`, and it rests on `(2, 0)` — the anchor's southeast neighbour.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, neighbor, place } from "../field";
import {
  challenge,
  loneMote,
  molecule,
  mote,
  risePart,
  solution,
} from "../formats";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
  openBareRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The pattern coordinate the review item names, and the anchor it is placed on. */
const PATTERN = at(1, 0);
const ANCHOR = at(2, -1);

/** One `nova` on `(1, 0)`: a pattern whose coordinate is not the origin. */
const OFFSET_REAGENT = challenge({
  name: "Offset Reagent",
  reagents: [molecule([mote(PATTERN.q, PATTERN.r, "nova")])],
  products: [loneMote("nova")],
  permitted: ["arm"],
});

it("spawns the pattern mote one clockwise step round, southeast of its anchor", async () => {
  await openBareRun(h, {
    challenge: OFFSET_REAGENT,
    machine: solution([risePart(0, ANCHOR.q, ANCHOR.r, 1)]),
  });

  const bare = await h.snapshot();
  assertEqual(
    bare.sim?.motes.length,
    0,
    "the opener empties the field, so nothing stands where the reagent will appear",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "turned");

  const snapshot = await h.snapshot();
  assertNotNull(snapshot.sim, "the run is live through the boundary");
  assertNull(
    snapshot.sim?.fault ?? null,
    "a machine that is one rise moves nothing, so nothing faults",
  );
  assertEqual(
    looseMotes(snapshot).length,
    1,
    "the reagent is one new mote per pattern mote, and this pattern holds one",
  );

  const landed = place(PATTERN, ANCHOR, 1);
  assertEqual(
    `${landed.q},${landed.r}`,
    "2,0",
    "(1, 0) turned one clockwise step is (0, 1), and (0, 1) + (2, -1) is (2, 0)",
  );
  assertEqual(
    `${landed.q},${landed.r}`,
    `${neighbor(ANCHOR, 1).q},${neighbor(ANCHOR, 1).r}`,
    "DIRS[1] is (0, +1), toward southeast, so the mote lands one hex southeast of the anchor",
  );

  const spawned = moteAt(snapshot, landed);
  assertNotNull(
    spawned,
    "a rise at rotation 1 turns each pattern coordinate one clockwise step before translating it",
  );
  assertEqual(
    spawned?.type,
    "nova",
    "the mote the rise spawned is the pattern's own mote type",
  );
  assertNull(
    moteAt(snapshot, place(PATTERN, ANCHOR, 0)),
    "rotation 1 is not rotation 0: nothing rests on the hex the unturned pattern would have used",
  );
});
