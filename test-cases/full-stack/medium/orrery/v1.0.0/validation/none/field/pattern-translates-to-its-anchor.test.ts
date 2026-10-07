// field/pattern-translates-to-its-anchor — at rotation `0` a pattern is its own
// coordinates, moved to the anchor.
//
// THE RULE, from `specs/field.md` (Molecule patterns): "A pattern is placed onto
// the field at an anchor hex and a rotation `0` to `5`: each pattern coordinate is
// rotated about `(0, 0)` by the rotation, using the formulas above, then
// translated by the anchor." At rotation `0` the turn is the identity, so what is
// left is the translation alone — the pattern coordinate PLUS the anchor, rather
// than the pattern coordinate ignored, the anchor ignored, or the two subtracted.
//
// WHERE THE PLACED PATTERN BECOMES OBSERVABLE. `specs/sigils.md` (`rise`): "A
// rise's footprint is as `specs/parts.md` defines it. When every footprint hex is
// vacant, the reagent appears: one new mote per pattern mote and one filament per
// pattern filament, at the placed pose, unheld." And `specs/parts.md`: "its
// footprint is its pattern's hexes placed at that pose: the molecule pattern for a
// rise". So the hex a rise's mote appears on IS the pattern hex placed, and the
// boundary is when it appears: "sigils act ... At each boundary, the settle
// included", and "After the four waves, every set is evaluated, then every rise"
// (`specs/simulation.md`, The sigil phase).
//
// THE CONFIGURATION IS THE ONE THE REVIEW ITEM STATES. A challenge whose only
// reagent is one `nova` on the pattern coordinate `(1, 0)` — a one-mote pattern,
// which `specs/formats.md` requires to carry no filament — and a rise for it
// anchored on `(2, -1)` at rotation `0`. `(1, 0) + (2, -1)` is `(3, -1)`, which
// `max(|3|, |-1|, |2|) <= FIELD_R` puts on the field.
//
// THE WORLD IS EMPTY AROUND IT. The bare opener resets, poses the challenge, loads
// this one part, holds the completion switch off, starts the run and empties the
// field, so the machine is a rise and nothing else and the field is bare when the
// cycle begins. Nothing on it moves, nothing else can spawn, and the one mote read
// back is the one the rise put there.
//
// THE VERDICT. Exactly one mote is on the field after the boundary, it is the
// pattern's `nova`, and it rests on `(3, -1)`.

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

it("spawns the pattern mote on the pattern coordinate plus the anchor", async () => {
  await openBareRun(h, {
    challenge: OFFSET_REAGENT,
    machine: solution([risePart(0, ANCHOR.q, ANCHOR.r, 0)]),
  });

  const bare = await h.snapshot();
  assertEqual(
    bare.sim?.motes.length,
    0,
    "the opener empties the field, so nothing stands where the reagent will appear",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "anchored");

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

  const landed = place(PATTERN, ANCHOR, 0);
  assertEqual(
    `${landed.q},${landed.r}`,
    "3,-1",
    "the pattern coordinate (1, 0) placed on anchor (2, -1) at rotation 0 is (3, -1)",
  );
  const spawned = moteAt(snapshot, landed);
  assertNotNull(
    spawned,
    "at rotation 0 the pattern is translated by the anchor, so its mote rests on (3, -1)",
  );
  assertEqual(
    spawned?.type,
    "nova",
    "the mote the rise spawned is the pattern's own mote type",
  );
  assertNull(
    spawned?.wheel ?? null,
    "a rise spawns a mote of the field rather than a wheel's fixture",
  );
});
