// tape/run-leaves-the-loads-starting-poses-untouched — a run moves the loads it
// carries and leaves their authored starting poses alone.
//
// `specs/program.md` § Starting and ending a run: "Either way the structure, the
// tape, and the loads' starting poses are untouched: every run begins from the
// same authored state." `specs/state.md` splits
// the two readings the requirement is about: the site's loads carry "its starting
// pose, and its target pose", while a run carries "each load's run state … its
// lift point's current position, and its yaw" — one entry per load the run
// started with, and a run's start leaves each "`waiting` at the pose it stands
// at".
//
// THE RUN GENUINELY CARRIES THE LOAD AWAY before either reading is taken: the
// trolley drives out along the track, the pivot goes with it, and the check
// sweeps until the load's run position has left where it stands in the yard. A
// build that moved the yard's own copy as it carried the load would be caught by
// the first reading; one that started the next run from where the last one left
// off would be caught by the second.
//
// THE HOOK IS POSED ONTO THE CRATE RATHER THAN LOWERED ONTO IT. Reaching the load
// by paying the cable in and running an `attach` would put the hoist controller
// and the candidate search on the route to a scenario that is about neither of
// them — a build that missed the attach would fail this point for a defect two
// other validators already name. So the cable is set to `HOIST_MIN`, the bob is
// put at the crate's own lift point at rest, and `setLoadPhase` hangs it there,
// which `specs/instrumentation.md` says leaves the load "exactly as a successful
// `attach` leaves it". That is the precondition; the CARRYING is still earned,
// tick by tick, by the trolley move the tape holds.
//
// THE RUN IS ENDED WITH AN ABORT, so no verdict of any kind has been reached when
// the readings are taken: `abortRun` "poses the abort, ending a running run with
// no verdict" and puts the run back to its idle placeholder
// (`specs/instrumentation.md`).
//
// The yard holds one load and no obstacle, and the crane is the minimal one. The
// crate stands a unit below the pivot the trolley starts under, so it hangs a
// unit clear of the ground, which keeps `specs/statics.md`'s ground test out of a
// reading that is about the yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MIN, TROLLEY_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the crate stands in the yard: a cable's length below the pivot. */
const FROM = { x: 0, y: 4 - HOIST_MIN, z: 0, yaw: 0 };

/** The pad it is wanted on, which this run never reaches. */
const TO = { x: -4, y: 2, z: 0, yaw: 0 };

/** Drive the trolley out along the track, carrying the pivot and the hook. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 2, rate: TROLLEY_MAX_RATE }],
  },
];

/** How far the carried load must have travelled before the readings are taken. */
const CARRIED = 0.1;

/** Ticks the sweep is given: the trolley covers that inside half a second. */
const CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the next run with the load back at its authored pose", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, TAPE);
  await startRun(h);

  // The precondition: the hook on the crate, the crate on the hook, both at rest
  // exactly where the yard says the crate stands.
  await h.debug.setAxis("hoist", HOIST_MIN);
  await h.debug.setBob(FROM.x, FROM.y, FROM.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setLoadPhase(0, "attached");

  const carried = await runUntil(
    h,
    (s) =>
      s.run.loads[0]?.phase === "attached" &&
      distance3(s.run.loads[0].pos, FROM) > CARRIED,
    CAP,
    "the run to carry the crate away from where it stands",
  );
  assertGreaterThan(
    distance3(carried.run.loads[0]!.pos, FROM),
    CARRIED,
    "how far the run had carried the load when the yard was read",
  );

  await h.debug.abortRun();
  const yard = await h.snapshot();

  assertDeepEqual(
    yard.site.loads[0]?.from,
    FROM,
    "the load's starting pose in the yard after a run that carried it: a run " +
      "leaves the loads' starting poses untouched (specs/program.md)",
  );
  assertDeepEqual(
    yard.site.loads[0]?.to,
    TO,
    "the pad the load is wanted on after that run",
  );

  const again = await startRun(h);
  await h.capture(
    "state",
    "The next run, starting the load where it was authored",
  );

  assertEqual(again.run.tick, 0, "run.tick immediately after the second start");
  assertEqual(
    again.run.loads[0]?.phase,
    "waiting",
    "the load's phase at the second run's start (specs/state.md)",
  );
  assertDeepEqual(
    again.run.loads[0]?.pos,
    { x: FROM.x, y: FROM.y, z: FROM.z },
    "where the second run's load stands at its start: the pose the yard " +
      "carries, so every run begins from the same authored state " +
      "(specs/program.md)",
  );
  assertEqual(
    again.run.loads[0]?.yaw,
    FROM.yaw,
    "the yaw the second run's load starts at",
  );
});
