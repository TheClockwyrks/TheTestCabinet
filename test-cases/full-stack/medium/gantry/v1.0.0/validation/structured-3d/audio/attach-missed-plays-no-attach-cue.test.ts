// audio/attach-missed-plays-no-attach-cue — an attach that finds nothing is
// silent.
//
// specs/ui.md § Audio binds `attach` to "a load attaches", and specs/rigging.md §
// Attaching says which attaches do not: the candidate is the `waiting` load
// nearest the hook "if that distance is at most `ATTACH_RADIUS` (`0.8`)", and
// "With no candidate, the run ends as `attach-missed`." Nothing takes the hook,
// so there is no event for the cue to play on — the clunk of the hook seizing a
// load is a lie when the hook came away empty, and the run is over.
//
// THE YARD HOLDS ONE LOAD AND IT IS OUT OF REACH. Emptying the yard entirely
// would also make the attach miss, but a yard with a load in it decides more: a
// build that plays the cue whenever an `attach` step executes, or whenever
// anything is in the yard, sounds here. The load stands `10` units from the hook
// point, better than twelve times `ATTACH_RADIUS`, so no reading of the distance
// brings it inside.
//
// THE HOOK POINT IS POSED, so the distance is the one written here rather than
// one that depends on where a tick left the bob: `setBob` puts it where the run
// starts it — the pivot minus `(0, HOIST_START, 0)` — so the cable holds it and
// nothing moves.
//
// THE TAPE OPENS WITH A MOVE WHOSE TARGET IS THE AXIS'S CURRENT VALUE, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the `attach` executes on a tick of its own and the cue
// queue read for it holds that tick alone. The `run-start` cue is drained before
// it for the same reason.
//
// THE RUN'S VERDICT IS READ BACK, because the silence only means anything against
// an attach that really did miss: an attach that found a candidate would be a
// different scenario, and its own point's business.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  ATTACH_RADIUS,
  GRIP_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The one load in the yard, far outside any reading of ATTACH_RADIUS. */
const LOAD_AT = { x: 10, y: 2, z: 0, yaw: 0 };

/** A move whose target is the axis's value: one tick, and nothing moves. */
const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

/** A move after the attach, so a run that survived it is visibly still running. */
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

it("plays no attach cue on the tick an attach finds no candidate", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, LOAD_AT, LOAD_AT);
  await poseTape(h, [NOOP, { kind: "action", action: "attach" }, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  await h.cues();

  const missed = await runTicks(h, 1);
  const onMiss = await h.cues();
  await h.capture("missed", "The tick the attach missed");

  assertEqual(
    missed.run.cause,
    "attach-missed",
    `the cause an \`attach\` ends the run with when the only waiting load is ` +
      `${distance3(HOOK, LOAD_AT)} from the hook point, against an ` +
      `ATTACH_RADIUS of ${ATTACH_RADIUS} (specs/rigging.md § Attaching)`,
  );
  assertTrue(
    !onMiss.includes("attach"),
    "the `attach` cue on the tick an attach found no candidate: the cue " +
      'follows "a load attaches" (specs/ui.md § Audio), and no load took the ' +
      `hook — the run ended as attach-missed. The tick sounded ` +
      `${JSON.stringify(onMiss)}`,
  );
});
