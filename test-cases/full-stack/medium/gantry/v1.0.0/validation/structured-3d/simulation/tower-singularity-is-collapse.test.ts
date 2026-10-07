// simulation/tower-singularity-is-collapse — a singular tower solve ends the run
// as collapse, just as a singular arm solve does.
//
// specs/statics.md § Singularity: "A singular solve, in either the arm or the
// tower, at any point in the slack-cable iteration or the breakage sequence, ends
// the run as `collapse`." § The two solves fixes the order the three checks run
// in — "the arm solve, whose singularity is a `collapse`; then the ring check ...
// then the tower solve, whose singularity is a `collapse`" — so this point is the
// third of them, reached only once the arm solve and the ring check have passed.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE LESS THE FOUR DIAGONALS ON THE TOWER'S
// SIDES. What is left of the tower is four vertical legs from the site's anchors
// to the ring's bottom flange, the flange square, and one diagonal across that
// square: the square is rigid in its own plane and the legs hold it up, but
// nothing braces the box against shear, so the tower is a mechanism and its solve
// is singular. The arm is untouched and is the sound one the minimal crane
// carries, so the arm solve is regular and the collapse is the tower's.
//
// Removing them breaks no readiness rule: the ring stands, the single rail is
// untouched, and every member still has a path to an anchor or a flange node, so
// the run starts and the verdict comes from the pipeline rather than a refusal.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/** Where MINIMAL_CRANE's four side diagonals sit in its member list. */
const DIAGONALS_FROM = 9;
const DIAGONALS_TO = 13;

/** The minimal crane with an unbraced box for a tower. */
const SHEARING_TOWER: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, less the four diagonals on the tower's sides",
  members: [
    ...MINIMAL_CRANE.members.slice(0, DIAGONALS_FROM),
    ...MINIMAL_CRANE.members.slice(DIAGONALS_TO),
  ],
};

/** A tape that keeps the run ticking and touches nothing the solve reads. */
const TURN_THE_GRIP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as collapse on the tick a singular tower solve is reached", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, SHEARING_TOWER);
  await poseTape(h, TURN_THE_GRIP);
  await startRun(h);

  const { run } = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    run.phase,
    "failed",
    "the run's phase on the first tick whose tower solve is singular, the " +
      "tower being a box with nothing bracing it against shear " +
      "(specs/statics.md § Singularity)",
  );
  assertEqual(
    run.cause,
    "collapse",
    "the cause a singular tower solve ends the run with " +
      "(specs/statics.md § The failure causes)",
  );
});
