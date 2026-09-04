// instrumentation/set-load-phase-attached-hangs-the-load — the pose hangs a
// load on the hook whatever its distance, and reaches no verdict doing it.
//
// `specs/instrumentation.md` § The run in progress: "`setLoadPhase` to
// `"attached"` hangs that load on the hook exactly as a successful `attach`
// leaves it, without the candidate search and without the `attach-missed`
// verdict". The `attach` ACTION is the one that searches: "The candidate is the
// `waiting` load whose lift point is nearest the hook point ... if that distance
// is at most `ATTACH_RADIUS` (`0.8`)" and "With no candidate, the run ends as
// `attach-missed`" (`specs/rigging.md`). The pose is the surface's way past
// that, which is what lets a scenario about a hanging load start with one
// hanging rather than fly the hook to it first.
//
// SO THE LOAD IS PUT WHERE THE SEARCH WOULD REFUSE IT. The one load stands far
// outside `ATTACH_RADIUS` of the hook — the check reads the hook point off the
// run rather than assuming where the crane put it, and asserts the distance
// first, so the scenario is the one the requirement is about whatever crane a
// build stands. A build that ran the candidate search through this pose would
// leave the load `waiting` and the run `failed` as `attach-missed`; a build that
// honours the specification hangs it and leaves the run alone.
//
// Nothing is advanced between the pose and the reading: a pose "establishes a
// precondition and never an outcome", so what it owes is readable at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { ATTACH_RADIUS, GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Where the one load stands: metres from any hook a minimal crane hangs. */
const FROM = { x: 10, y: 3, z: 0, yaw: 0 };
const TO = { x: 0, y: 3, z: 10, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hangs a load far outside ATTACH_RADIUS of the hook", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, HOLD_TAPE);
  const started = await startRun(h);
  await h.advance(1);

  // The hook point is the bob's position (`specs/rigging.md`), read off the run
  // rather than assumed, so the scenario is the one the requirement names.
  const waiting = started.run.loads[0];
  assertGreaterThan(
    distance3(waiting?.pos ?? { x: NaN, y: NaN, z: NaN }, started.run.bob.pos),
    ATTACH_RADIUS,
    "the load's distance from the hook, which the attach action would refuse " +
      `as further than ATTACH_RADIUS (${ATTACH_RADIUS}) (specs/rigging.md)`,
  );

  await h.debug.setLoadPhase(0, "attached");
  const { run } = await h.snapshot();

  await h.capture("attached", "The load hung on the hook by the pose");

  assertEqual(
    run.attached,
    0,
    'run.attached after setLoadPhase(0, "attached") on a load the candidate ' +
      "search would not have found (specs/instrumentation.md)",
  );
  assertEqual(
    run.loads[0]?.phase,
    "attached",
    "run.loads[0].phase after the pose (specs/instrumentation.md)",
  );
  assertEqual(
    run.phase,
    "running",
    "the run's phase: the pose carries no attach-missed verdict " +
      "(specs/instrumentation.md)",
  );
  assertNull(run.cause, "the run's cause after the pose");
});
