// instrumentation/set-load-phase-placed-sits-at-the-target — a load posed
// `placed` sits at exactly its target pose, and stays there.
//
// `specs/instrumentation.md` § The run in progress: "`"placed"` sets the load
// down exactly as a successful `release` leaves it: it sits at exactly its
// target pose and stays there for the rest of the run (`specs/world.md`)". That
// is the release's own outcome — "the load is `placed`: it leaves the hook, sits
// at exactly its target pose for the rest of the run" (`specs/rigging.md`) —
// carried onto the pose, and the target pose is the one `setLoadTarget` gave the
// load, which the snapshot reports as `site.loads[index].to`.
//
// TWO READINGS, ONE RULE. "Sits at exactly its target pose" is read at the call
// and "stays there for the rest of the run" is read after the run has ticked on,
// so the check reads the same load twice with twenty ticks of real simulation
// between them. The tape still has its move step live throughout, so the run is
// genuinely advancing between the two readings rather than sitting ended.
//
// THE LOAD IS PUT SOMEWHERE ITS PAD IS NOT FIRST, so a build that simply left
// the load where it stood could not pass. The world holds exactly the one load,
// and its pad is a long way from both its starting pose and the pose it is
// carried to.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertEqual,
  assertLength,
  assertVec3Near,
} from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  createHarness,
  openSite,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/**
 * A tape that keeps a run in progress and asks nothing of the structure.
 *
 * Appended through the tape editor's own screen, which is where the tape poses
 * apply (`specs/instrumentation.md`), and left there: `startRun` poses the `run`
 * action, which the program screen carries as well as the build screen.
 */
async function poseHoldTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addMoveStep("grip", 360, GRIP_MAX_RATE);
}

const FROM = { x: 10, y: 3, z: 0, yaw: 0 };
const TO = { x: -6, y: 3, z: 8, yaw: 90 };

/** Where the load is carried to before it is set down: neither of those. */
const CARRIED = { x: 3, y: 7, z: -4, yaw: 20 };

/** Real simulation between the two readings. */
const TICKS = 20;

/** "Exactly its target pose". */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets a load down at exactly its target pose, and leaves it there", async () => {
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared — and `addOneLoad` clears the loads itself.
  await openSite(h, 0);
  await h.debug.clearObstacles();
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseHoldTape(h);
  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the steps the tape took, so the run keeps ticking under both readings",
  );
  await h.advance(1);

  await h.debug.setLoadPose(0, CARRIED.x, CARRIED.y, CARRIED.z, CARRIED.yaw);
  await h.debug.setLoadPhase(0, "placed");
  const down = await h.snapshot();

  const target = down.site.loads[0]?.to;
  assertEqual(
    JSON.stringify(target),
    JSON.stringify(TO),
    "the pad the check gave the load, as the open site reports it",
  );
  assertEqual(
    down.run.loads[0]?.phase,
    "placed",
    'run.loads[0].phase after setLoadPhase(0, "placed")',
  );
  assertVec3Near(
    down.run.loads[0]?.pos ?? { x: NaN, y: NaN, z: NaN },
    TO,
    TOLERANCE,
    "run.loads[0].pos at the call: exactly its target pose " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    down.run.loads[0]?.yaw ?? NaN,
    TO.yaw,
    TOLERANCE,
    "run.loads[0].yaw at the call: exactly its target pose " +
      "(specs/instrumentation.md)",
  );

  const later = await runTicks(h, TICKS);
  await h.capture("placed", "The placed load a run second later");

  assertEqual(
    later.run.phase,
    "running",
    `the run still advancing ${TICKS} ticks later, so the readings below are ` +
      "taken across a run rather than after one ended",
  );
  assertVec3Near(
    later.run.loads[0]?.pos ?? { x: NaN, y: NaN, z: NaN },
    TO,
    TOLERANCE,
    `run.loads[0].pos ${TICKS} ticks later: it stays at its target pose for ` +
      "the rest of the run (specs/instrumentation.md)",
  );
  assertClose(
    later.run.loads[0]?.yaw ?? NaN,
    TO.yaw,
    TOLERANCE,
    `run.loads[0].yaw ${TICKS} ticks later (specs/instrumentation.md)`,
  );
});
