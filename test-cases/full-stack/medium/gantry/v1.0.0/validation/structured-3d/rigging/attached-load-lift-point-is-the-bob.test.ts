// rigging/attached-load-lift-point-is-the-bob — while a load hangs, it stands
// exactly where the bob does.
//
// `specs/rigging.md` § The pivot and the bob: "The hook point and the attached
// load's lift point are both the bob's position." One position, reported twice,
// so there is nothing to interpolate and nothing to lag: on every tick a load is
// `attached`, `run.loads[i].pos` is `run.bob.pos`.
//
// THE LOAD IS CARRIED THROUGH EVERYTHING THAT MOVES THE BOB. The tape slews the
// arm and runs the trolley out together, so the bob swings under a pivot that is
// turning and travelling at once and the reading is taken on every tick of it — a
// build that hung the load off the hook by a stale position, or drew it toward the
// hook over a few frames, parts from the bob the moment the swing begins.
//
// THE LOAD IS PUT ON THE HOOK BY A POSE, AND THE CARRY STARTS AT THE FIRST TICK.
// `setLoadPhase` to `"attached"` hangs a load "exactly as a successful `attach`
// leaves it, without the candidate search and without the `attach-missed`
// verdict" (`specs/instrumentation.md`), which is a precondition: what this check
// decides is what the run then reports about a load that IS hanging. Hoisting the
// cable in and running an `attach` step first would spend half a second of ticks
// reaching the same precondition through two requirements that are other
// validators' — and every tick of that half second is a tick this one does not
// read.
//
// WHY THE CABLE IS DRAWN IN. The crate is `2` units tall and its box hangs "its
// full height below" the lift point (`specs/world.md`), while `HOIST_START` (`2`)
// below the minimal crane's pivot puts the hook at `y = 2` exactly. Posing the
// hoist at `HOIST_MIN` (`1`) lifts the hook to `y = 3`, so the carried crate rides
// a unit clear of the ground and no tick of the swing can end the run as
// `load-struck-ground` (`specs/statics.md`) for a reason this requirement is not
// about. The bob is posed there in the same breath, at rest, so the pendulum's
// constraint has nothing to answer on the tick that follows.
//
// The yard holds that one load and no obstacle, and the sampling stops well inside
// the tape's one step, so the run is still running for every reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertVec3Near,
} from "../assert";
import { HOIST_MIN, SLEW_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The minimal crane's track, and so its pivot, stands at `y = 4`. */
const PIVOT_Y = 4;

/** Where the hook stands once the cable is posed in to HOIST_MIN. */
const HOOK = { x: 0, y: PIVOT_Y - HOIST_MIN, z: 0, yaw: 0 };

/** A crate light enough that the swing asks nothing of the crane's capacity. */
const MASS = 20;

/** Swing it: a slew and a trolley run together, both far from arriving. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 25, rate: SLEW_MAX_RATE },
      { axis: "trolley", target: 3, rate: TROLLEY_MAX_RATE },
    ],
  },
];

/**
 * Ticks sampled, every one of them a tick of the carry.
 *
 * A one-unit cable swings with a period of about two seconds (`2 * pi *
 * sqrt(L / GRAVITY)`), so forty ticks is a third of a swing under a pivot that is
 * turning and travelling the whole time — forty independent readings of one
 * position reported twice, taken while the bob is moving fastest.
 */
const TICKS = 40;

/** Arithmetic slack on two readings of one position. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the hanging load's lift point at the bob's own position", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", HOIST_MIN);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  await h.debug.setBobVelocity(0, 0, 0);

  let carried = 0;
  let phase = "running";
  for (let tick = 1; tick <= TICKS; tick += 1) {
    const { run } = await runTicks(h, 1);
    phase = run.phase;
    if (run.phase !== "running") break;
    const load = run.loads[0];
    if (load === undefined || load.phase !== "attached") continue;
    carried += 1;
    assertVec3Near(
      load.pos,
      run.bob.pos,
      TOLERANCE,
      `tick ${tick}: the attached load's lift point, which is the bob's own ` +
        "position (specs/rigging.md)",
    );
  }

  await h.capture("carry", "The load carried through a slew and a trolley run");

  assertEqual(
    phase,
    "running",
    "the run through the sampled ticks, so every reading was taken on a " +
      "tick of the carry",
  );
  assertGreaterThanOrEqual(
    carried,
    TICKS,
    "the sampled ticks that found the load hanging on the hook, over which " +
      "the two positions were read against each other (specs/rigging.md)",
  );
});
