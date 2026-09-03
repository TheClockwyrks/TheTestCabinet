// collisions/structure-does-not-collide-with-itself — the structure never
// collides with itself.
//
// specs/statics.md § Collisions: "The structure never collides with itself or
// with a load", and the body table above it tests a member against obstacles
// alone. specs/structure.md § Members says the same thing from the editor's side:
// "two members whose segments cross in space are not joined there and pass
// through one another freely". So two members that cross raise nothing, for the
// whole run.
//
// THE TWO MEMBERS CROSS EXACTLY, MID-SPAN, AND SHARE NOTHING. They are the two
// diagonals of the minimal crane's top-flange square: `(0, 4, 0)` to `(2, 4, 2)`
// and `(2, 4, 0)` to `(0, 4, 2)`. Their segments meet at `(1, 4, 1)`, each one's
// own midpoint, which is no lattice node — the lattice is the points whose
// coordinates are multiples of LATTICE_PITCH (`2`) (specs/world.md § The
// lattice) — and no end node is shared between them. Both join top-flange nodes
// only, so neither reaches the tower and the ring rule accepts them.
//
// AND THE RUN IS DRIVEN THROUGH A QUARTER TURN rather than held still: the two
// members are carried through it crossing the whole way, which is what "for the
// whole run" asks for. The sweep is driven a tick at a time until the run ends,
// so a build that raises a failure at any tick of it is caught at that tick, and
// the yard is emptied first, so a member is the only body in the run that can
// reach anything at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertNull } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runUntil,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The point the two added members cross at: each one's midpoint, no node. */
const CROSSING = { x: 1, y: 4, z: 1 } as const;

/** The minimal crane, with both diagonals of the top-flange square. */
const CROSSED: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with two crossing top-flange diagonals",
  members: [
    ...MINIMAL_CRANE.members,
    [[0, 4, 0], [2, 4, 2], "strut"],
    [[2, 4, 0], [0, 4, 2], "strut"],
  ],
};

/** A quarter turn, so the crossing is carried through a moving run. */
const SWEEP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
  },
];

/** Ticks the tape is given: a quarter turn at SLEW_MAX_RATE and its ramps. */
const CAP = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs a tape out with two members crossing in space", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, CROSSED);
  await poseTape(h, SWEEP);
  await startRun(h);

  const s = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    CAP,
    "the tape to run out with the two crossing members aboard",
  );
  await h.capture("crossing", "The two crossing members mid-run");

  assertNull(
    s.run.cause,
    `the failure cause of a run whose arm carries two members crossing at ` +
      `(${CROSSING.x}, ${CROSSING.y}, ${CROSSING.z}), sharing no end node: ` +
      "the structure never collides with itself (specs/statics.md)",
  );
  assertNotEqual(
    s.run.phase,
    "failed",
    "the run the two crossing members were carried through",
  );
});
