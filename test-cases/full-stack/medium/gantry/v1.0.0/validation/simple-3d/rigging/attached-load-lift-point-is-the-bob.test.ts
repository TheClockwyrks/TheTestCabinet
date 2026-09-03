// rigging/attached-load-lift-point-is-the-bob — while a load hangs, it stands
// exactly where the bob does.
//
// `specs/rigging.md` § The pivot and the bob: "The hook point and the attached
// load's lift point are both the bob's position." One position, reported twice,
// so there is nothing to interpolate and nothing to lag: on every tick a load is
// `attached`, `run.loads[i].pos` is `run.bob.pos`.
//
// THE LOAD IS CARRIED THROUGH EVERYTHING THAT MOVES THE BOB. The tape hoists the
// cable in, attaches, and then slews the arm and runs the trolley out together, so
// the bob swings under a pivot that is turning and travelling at once and the
// reading is taken on every tick of it — a build that hung the load off the hook
// by a stale position, or drew it toward the hook over a few frames, parts from
// the bob the moment the swing begins.
//
// WHY THE CABLE IS DRAWN IN FIRST. The crate is `2` units tall and its box hangs
// "its full height below" the lift point (`specs/world.md`), while
// `HOIST_START` (`2`) below the minimal crane's pivot puts the hook at `y = 2`
// exactly. Hoisting to `HOIST_MIN` (`1`) first lifts the hook to `y = 3`, so the
// carried crate rides a unit clear of the ground and no tick of the swing can end
// the run as `load-struck-ground` (`specs/statics.md`) for a reason this
// requirement is not about. The load waits at that same point, so the `attach`
// finds it at nothing like `ATTACH_RADIUS` away.
//
// The yard holds that one load and no obstacle, and the sampling stops inside the
// last step of the tape, so the run is still running for every reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertVec3Near,
} from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_MIN,
  SLEW_MAX_RATE,
  TROLLEY_MAX_RATE,
} from "../constants";
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

/** Where the hook stands once the cable is drawn in to HOIST_MIN. */
const HOOK = { x: 0, y: 3, z: 0, yaw: 0 };

/** A crate light enough that the swing asks nothing of the crane's capacity. */
const MASS = 20;

/** Draw in, take the load, then swing it: a slew and a trolley run together. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 25, rate: SLEW_MAX_RATE },
      { axis: "trolley", target: 3, rate: TROLLEY_MAX_RATE },
    ],
  },
];

/** Ticks sampled: inside the tape's last step, which ends around tick 115. */
const TICKS = 110;

/** How many of them must have found the load hanging for this to say anything. */
const CARRIED_TICKS = 60;

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
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

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

  await h.capture("carry", "The load carried through a slew and a hoist");

  assertEqual(
    phase,
    "running",
    "the run through the sampled ticks, so every reading was taken on a " +
      "tick of the carry",
  );
  assertGreaterThanOrEqual(
    carried,
    CARRIED_TICKS,
    "the sampled ticks that found the load hanging on the hook, over which " +
      "the two positions were read against each other (specs/rigging.md)",
  );
});
