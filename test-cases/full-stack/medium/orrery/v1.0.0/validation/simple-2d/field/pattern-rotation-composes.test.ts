// field/pattern-rotation-composes — rotation `k` is the clockwise step taken `k`
// times, not a flip.
//
// THE RULE, from `specs/field.md` (Molecule patterns): "A pattern is placed onto
// the field at an anchor hex and a rotation `0` to `5`: each pattern coordinate is
// rotated about `(0, 0)` by the rotation, using the formulas above, then
// translated by the anchor." The formula above it is the ONE STEP —
// "Clockwise: `(q, r) -> (-r, q + r)`" — and a rotation of `0` to `5` names how
// many of those steps a placement is, because "Rotating a direction index
// clockwise adds `1` modulo `6`". So the placement operation is that step
// COMPOSED with itself, and two placements that differ by more than one step land
// on different hexes.
//
// THE TWO ROTATIONS THE REVIEW ITEM NAMES.
//
//   * Rotation `3`, applied to the pattern coordinate `(1, 0)`:
//     `(1, 0) -> (0, 1) -> (-1, 1) -> (-1, 0)`, which is `(1, 0)` NEGATED — three
//     steps being half a turn. Placed on the anchor `(2, -1)`: `(1, -1)`.
//   * Rotation `5`, applied to the same coordinate: five steps,
//     `(1, 0) -> (0, 1) -> (-1, 1) -> (-1, 0) -> (0, -1) -> (1, -1)`. Placed on
//     the same anchor: `(3, -2)`.
//
// A build that treats every non-zero rotation as the half turn — the single flip
// the negation at rotation `3` invites — puts rotation `5` on `(1, -1)` as well,
// and fails the second half of this check. A build that composes the step the
// stated number of times puts it on `(3, -2)`, two hexes away.
//
// WHERE IT BECOMES OBSERVABLE. `specs/sigils.md` (`rise`): "When every footprint
// hex is vacant, the reagent appears: one new mote per pattern mote and one
// filament per pattern filament, at the placed pose, unheld", the rises running
// "After the four waves" of each boundary (`specs/simulation.md`, The sigil phase).
//
// TWO POSES, EACH ITS OWN WORLD. Both open through the bare opener — reset, the
// posed challenge, a machine that is one rise, the completion switch off, a live
// run, an empty field — so the second scenario shares nothing with the first but
// the pattern and the anchor. The rotation is the only thing that differs between
// them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, place } from "../field";
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
  type OrrerySnapshot,
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

/** Pose a run whose whole machine is this rise at `rotation`, and reach a boundary. */
async function riseAt(rotation: number): Promise<OrrerySnapshot> {
  await openBareRun(h, {
    challenge: OFFSET_REAGENT,
    machine: solution([risePart(0, ANCHOR.q, ANCHOR.r, rotation)]),
  });
  const bare = await h.snapshot();
  assertEqual(
    bare.sim?.motes.length,
    0,
    `at rotation ${rotation} the opener empties the field before the boundary runs`,
  );
  await advanceCycles(h, 1);
  return h.snapshot();
}

/** Read the one mote a rise spawned, and where it rests. */
function sole(snapshot: OrrerySnapshot, rotation: number): void {
  assertNotNull(snapshot.sim, "the run is live through the boundary");
  assertNull(
    snapshot.sim?.fault ?? null,
    `at rotation ${rotation} a machine that is one rise moves nothing, so nothing faults`,
  );
  assertEqual(
    looseMotes(snapshot).length,
    1,
    `at rotation ${rotation} the reagent is one new mote per pattern mote, and this pattern holds one`,
  );
}

it("turns a pattern three steps at rotation 3 and five steps at rotation 5", async () => {
  // Both worlds are posed and both pictures are taken BEFORE either verdict, so a
  // failure on one rotation still leaves the evidence for the other.
  const three = await riseAt(3);
  await captureStill(h, "rot-3");
  const five = await riseAt(5);
  await captureStill(h, "rot-5");

  sole(three, 3);
  const halfTurn = place(PATTERN, ANCHOR, 3);
  assertEqual(
    `${halfTurn.q},${halfTurn.r}`,
    "1,-1",
    "three clockwise steps take (1, 0) to (-1, 0), the coordinate negated, and (-1, 0) + (2, -1) is (1, -1)",
  );
  assertNotNull(
    moteAt(three, halfTurn),
    "a rise at rotation 3 applies the clockwise step three times before translating",
  );
  assertEqual(
    moteAt(three, halfTurn)?.type,
    "nova",
    "the mote the rise spawned at rotation 3 is the pattern's own mote type",
  );

  sole(five, 5);
  const fiveSteps = place(PATTERN, ANCHOR, 5);
  assertEqual(
    `${fiveSteps.q},${fiveSteps.r}`,
    "3,-2",
    "five clockwise steps take (1, 0) to (1, -1), and (1, -1) + (2, -1) is (3, -2)",
  );
  assertNotNull(
    moteAt(five, fiveSteps),
    "a rise at rotation 5 applies the clockwise step five times rather than a single flip",
  );
  assertEqual(
    moteAt(five, fiveSteps)?.type,
    "nova",
    "the mote the rise spawned at rotation 5 is the pattern's own mote type",
  );
  assertNull(
    moteAt(five, halfTurn),
    "rotation 5 is not rotation 3: nothing rests on the hex half a turn would have used",
  );
});
