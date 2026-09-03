// simulation/breakage-cascade-to-collapse — a breakage cascade that leaves a
// mechanism ends the run as collapse.
//
// specs/statics.md § Utilization and breakage: "every member whose utilization
// exceeds `1` breaks: all of them are removed at once ... Both solves then run
// again at the same tick, over the members still intact ... in the same order and
// under the same checks. Repeat until a pass breaks nothing OR A PASS FAILS."
// § Singularity says what a failing pass costs: "A singular solve ... at any
// point in the slack-cable iteration OR THE BREAKAGE SEQUENCE, ends the run as
// `collapse`." So this point is a pass of the breakage sequence, not the first
// solve of the tick: the crane stands under its own weight, is overloaded, sheds
// members, and what is left is a mechanism.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE CARRYING A HEAVY LOAD AT ITS RAIL TIP.
// The trolley is posed to the far end of its track and a `200`-mass load is hung
// on the hook, which the load model applies at the trolley point as the cable
// force specs/rigging.md fixes — `(HOOK_MASS + 200) * GRAVITY` straight down at
// rest, comfortably under `HOIST_CABLE_CAP` so the cable does not snap first.
// The first pass takes the tie from the mast top to the rail tip past its
// capacity along with two others; with that tie gone every member left at the tip
// lies in the `y = 4` plane, so the pass that follows is the flat frame
// § Singularity calls a mechanism.
//
// The load is hung with `setLoadPhase`, which specs/instrumentation.md defines as
// hanging a load on the hook "exactly as a successful `attach` leaves it, without
// the candidate search", so this scenario never runs the `attach` action or the
// rules that belong to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/** Heavy enough to break the tip's ties, light enough not to snap the cable. */
const LOAD_MASS = 200;

/** The far end of the minimal crane's one-rail track, in units from its origin. */
const TIP = 4;

/** Where the load waits: on the hook, which is where it is hung from. */
const ON_THE_HOOK = { x: 0, y: 2, z: 0, yaw: 0 };

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

it("ends the run as collapse on the tick a breakage leaves a mechanism", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, ON_THE_HOOK, ON_THE_HOOK);
  await poseTape(h, TURN_THE_GRIP);

  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("trolley", TIP);
  const { run } = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertGreaterThan(
    run.broken.length,
    0,
    "the members this tick's first pass took past utilization 1, which is " +
      "what makes the pass that follows a breakage pass " +
      "(specs/statics.md § Utilization and breakage)",
  );
  assertEqual(
    run.phase,
    "failed",
    "the run's phase on the tick whose breakage pass reaches a singular " +
      "solve (specs/statics.md § Singularity)",
  );
  assertEqual(
    run.cause,
    "collapse",
    "the cause a pass of the breakage sequence that goes singular ends the " +
      "run with (specs/statics.md § The failure causes)",
  );
});
