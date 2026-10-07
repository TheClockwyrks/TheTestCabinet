// simulation/singular-inside-the-slack-iteration — a solve that goes singular
// once a cable drops out ends the run as collapse.
//
// specs/statics.md § Singularity: "A singular solve, in either the arm or the
// tower, AT ANY POINT IN THE SLACK-CABLE ITERATION or the breakage sequence, ends
// the run as `collapse`." § Slack cables says what that iteration does: "Solve
// with every candidate cable present; every cable whose force comes back negative
// goes slack, LEAVES THE SYSTEM ENTIRELY, and carries zero force; solve again with
// the remainder." So a structure can be regular with every cable present and a
// mechanism the moment one drops, and this point is that case: the singular solve
// is one the iteration reaches, not the one it starts from.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE WITH ITS MAST BRACED SIDEWAYS BY A
// SINGLE CABLE. The tie from `(2, 4, 2)` is removed and the tie from `(0, 4, 2)`
// is made a cable, so the mast top `(0, 8, 0)` keeps four members and only that
// cable has any `z` in it: with the cable present the mast has stiffness in three
// directions and the solve is regular; without it every member at the mast lies
// in the `z = 0` plane and the mast is free to swing sideways.
//
// WHAT SENDS THE CABLE SLACK IS THE ARM'S OWN TURNING. At rest the mast carries
// no sideways load at all, so the check solves the crane standing (asserted
// below, which is what makes this a singularity the ITERATION reached rather than
// a crane that was a mechanism all along). The tape then drives the slew, and
// § The load model gives an arm node under slew acceleration the force
// `-alpha * (k x r)` — a tangential push. Driving the slew toward `+90` pushes
// the mast the way the cable cannot resist, its force comes back negative, the
// iteration drops it, and the solve that follows is singular.
//
// One tick is enough: the tape's first move step issues its command on the first
// tick and the controller accelerates the slew on that same tick
// (specs/program.md § The tick pipeline), which is the tick the solve reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/** MINIMAL_CRANE's mast ties from `(0, 4, 2)` and from `(2, 4, 2)`. */
const Z_TIE = 15;
const OTHER_Z_TIE = 16;

/** The minimal crane whose mast is braced sideways by one cable alone. */
const CABLE_BRACED_MAST: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with the mast braced sideways by a single cable",
  members: MINIMAL_CRANE.members
    .map(
      (member, index): DesignMember =>
        index === Z_TIE ? [member[0], member[1], "cable"] : member,
    )
    .filter((_member, index) => index !== OTHER_Z_TIE),
};

/** Turn the arm: the slew acceleration is what pushes the mast sideways. */
const SLEW_ROUND: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as collapse when dropping a slack cable leaves a mechanism", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, CABLE_BRACED_MAST);

  // At rest the mast carries no sideways load, so the cable is taut and the
  // crane stands: the collapse below can only be the solve the iteration
  // reached once that cable left the system.
  const atRest = await h.check();
  assertTrue(
    atRest.stable,
    "the crane to stand at the run-start posture, with every cable present " +
      "(specs/structure.md § The static check)",
  );

  await poseTape(h, SLEW_ROUND);
  await startRun(h);
  const { run } = await runTicks(h, 1);
  await h.capture(
    "run-phase-run-cause-run-forces",
    "run.phase, run.cause, run.forces",
  );

  assertEqual(
    run.phase,
    "failed",
    "the run's phase on the first tick whose slack-cable iteration reaches a " +
      "singular solve (specs/statics.md § Singularity)",
  );
  assertEqual(
    run.cause,
    "collapse",
    "the cause a solve that goes singular once a cable drops out ends the " +
      "run with (specs/statics.md § The failure causes)",
  );
});
