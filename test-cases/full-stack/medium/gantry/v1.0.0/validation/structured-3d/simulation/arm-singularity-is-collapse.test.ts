// simulation/arm-singularity-is-collapse — a singular arm solve ends the run as
// collapse.
//
// specs/statics.md § Singularity: "A singular solve, in either the arm or the
// tower, at any point in the slack-cable iteration or the breakage sequence, ends
// the run as `collapse`. An under-braced 3D truss is the ordinary way to get
// here: a flat frame with nothing resisting out-of-plane motion is a mechanism
// even though every member is sound." This point is the arm half of that
// sentence, and the tower half is its own check.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE LESS THE TIE FROM THE MAST TOP TO THE
// RAIL TIP. That tie is the one member at the tip `(4, 4, 0)` with a vertical
// component; without it the rail from `(0, 4, 0)` and the two struts from
// `(0, 4, 2)` and `(2, 4, 2)` all lie in the `y = 4` plane, so the tip is free to
// fall and the arm solve is exactly the flat frame the specification names. The
// tower is untouched and fully braced, so the singular solve can only be the
// arm's — and the arm solve runs first, so it is also the first of the three to
// fail (§ The two solves).
//
// The run is started on an emptied yard with a tape that turns the grip alone:
// specs/rigging.md § The grip says turning the grip "applies no force to
// anything" and, with no load attached, "turns the bare hook, visibly and to no
// other effect", so the tape keeps the run ticking without posing anything the
// solve reads. The verdict comes from one tick of the real pipeline.

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

/** The minimal crane less the tie from `(0, 8, 0)` to the rail tip. */
const FLAT_TIP: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, less the rail tip's out-of-plane tie",
  members: MINIMAL_CRANE.members.slice(0, MINIMAL_CRANE.members.length - 1),
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

it("ends the run as collapse on the tick a singular arm solve is reached", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, FLAT_TIP);
  await poseTape(h, TURN_THE_GRIP);
  await startRun(h);

  const { run } = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    run.phase,
    "failed",
    "the run's phase on the first tick whose arm solve is singular, the arm " +
      "being a flat frame with nothing resisting out-of-plane motion " +
      "(specs/statics.md § Singularity)",
  );
  assertEqual(
    run.cause,
    "collapse",
    "the cause a singular arm solve ends the run with " +
      "(specs/statics.md § The failure causes)",
  );
});
