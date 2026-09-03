// rigging/attach-radius-bound — a load exactly ATTACH_RADIUS from the hook is
// still a candidate.
//
// specs/rigging.md § Attaching states the reach inclusively: the nearest waiting
// load is the candidate "if that distance is at most `ATTACH_RADIUS` (`0.8`)". At
// most, not less than — so a load standing exactly `0.8` from the hook point is
// taken, and a build that wrote `<` refuses a lift the specification allows.
//
// THE DISTANCE IS EXACTLY `ATTACH_RADIUS`, AND EXACTLY IS THE WHOLE POINT, so
// neither end of it is left to a tick. `setBob` "puts the bob where it is asked
// for", and the hook is posed at the position the run starts it at — the pivot
// minus `(0, HOIST_START, 0)`, which the cable holds at its current length — so
// the hook point on the tick the action executes is `(0, 2, 0)` and not a value a
// pendulum step drifted. The load then stands at `(ATTACH_RADIUS, 2, 0)`: the
// separation is one coordinate wide and exactly the figure `constants.ts` carries,
// however a build measures it.
//
// THE OTHER SIDE OF THE BOUND IS ANOTHER POINT'S. This one decides that the bound
// is reached, and `rigging/attach-missed-with-no-candidate` decides that a load
// out of reach is no candidate; asserting both here would be two requirements in
// one check.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the `attach` is not the run's own first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ATTACH_RADIUS,
  GRIP_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
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

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The one load in the yard, exactly ATTACH_RADIUS from the hook point. */
const LOAD_AT = {
  x: HOOK.x + ATTACH_RADIUS,
  y: HOOK.y,
  z: HOOK.z,
  yaw: 0,
};

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that keeps the run running past the `attach`. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a waiting load standing exactly ATTACH_RADIUS from the hook", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, LOAD_AT, LOAD_AT);
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);

  const taken = await runTicks(h, 1);
  await h.capture(
    "state",
    `one waiting load exactly ${ATTACH_RADIUS} from the hook point`,
  );

  assertEqual(
    taken.run.attached,
    0,
    "the load `attach` took: the one waiting load, standing exactly " +
      `ATTACH_RADIUS (${ATTACH_RADIUS}) from the hook point, which is "at ` +
      'most" that distance (specs/rigging.md § Attaching)',
  );
  assertEqual(
    taken.run.loads[0]?.phase,
    "attached",
    "the phase the load at exactly ATTACH_RADIUS comes away in",
  );
});
