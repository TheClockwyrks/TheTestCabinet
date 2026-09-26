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
// AND THE RUN IS DRIVEN THROUGH A SLEW rather than held still: the two members
// are carried through it crossing the whole way, which is what "for the whole
// run" asks for. The angle is ten degrees rather than a quarter turn because
// what the point needs of the motion is that the crossing MOVES, and a build
// that raised a collision between two crossing members would raise it on the
// first tick of the sweep as readily as the hundredth.
//
// THE RUN IS DRIVEN IN ONE BATCH rather than a tick at a time. A raised failure
// ENDS the run (specs/program.md), so the state the ticks left names the tick it
// was raised on whether or not the sweep stopped there: the phase and the cause
// read at the end are the whole reading, and sampling every tick to reach them
// buys nothing. The yard is emptied first, so a member is the only body in the
// run that can reach anything at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertNull } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
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

/** How far the arm is slewed, so the crossing is carried through a moving run. */
const SLEW_TARGET = 10;

/** A slew, so the crossing is carried through a moving run. */
const SWEEP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: SLEW_TARGET, rate: SLEW_MAX_RATE }],
  },
];

/**
 * Ticks driven in one batch before the sweep begins.
 *
 * `SLEW_TARGET` degrees under `SLEW_ACCEL` is a ramp up and straight back down
 * over `2 * sqrt(SLEW_TARGET / SLEW_ACCEL)` seconds — some seventy ticks — so
 * sixty is short of the tape running out on any conformant build.
 */
const CARRY = 60;

/** Ticks the sweep is given after that, for the tape to run out. */
const CAP = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs a tape out with two members crossing in space", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await poseCrane(h, CROSSED);
  await poseTape(h, SWEEP);
  await startRun(h);

  await runTicks(h, CARRY);
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
