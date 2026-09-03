// tape/run-leaves-the-loads-starting-poses-untouched — a run moves the loads it
// carries and leaves their authored starting poses alone.
//
// `specs/program.md` § Starting and ending a run: "Either way the structure, the
// tape, and the loads' starting poses are untouched: every run begins from the
// same authored state, and running is always repeatable." `specs/state.md` splits
// the two readings the requirement is about: the site's loads carry "its starting
// pose, and its target pose", while a run carries "each load's run state … its
// lift point's current position, and its yaw" — one entry per load the run
// started with, and a run's start leaves each "`waiting` at the pose it stands
// at".
//
// THE RUN GENUINELY CARRIES THE LOAD AWAY before either reading is taken: the
// tape pays the cable in, attaches the crate, and turns the arm, and the check
// sweeps until the load's run position has left where it stands in the yard. A
// build that moved the yard's own copy as it carried the load would be caught by
// the first reading; one that started the next run from where the last one left
// off would be caught by the second.
//
// THE RUN IS ENDED WITH AN ABORT, so no verdict of any kind has been reached when
// the readings are taken: `abortRun` "poses the abort, ending a running run with
// no verdict" and puts the run back to its idle placeholder
// (`specs/instrumentation.md`).
//
// The yard holds one load and no obstacle, and the crane is the minimal one. The
// crate is lifted from a point a unit above where the hook hangs at the run-start
// posture, so paying the cable in to `HOIST_MIN` brings the hook onto it: the
// attach is then within `ATTACH_RADIUS` (`0.8`) and the crate hangs a unit clear
// of the ground, which keeps `specs/statics.md`'s ground test out of a reading
// that is about the yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN, SLEW_MAX_RATE } from "../constants";
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

/** Where the crate stands in the yard: the hook's point once the cable is in. */
const FROM = { x: 0, y: 4 - HOIST_MIN, z: 0, yaw: 0 };

/** The pad it is wanted on, which this run never reaches. */
const TO = { x: -4, y: 2, z: 0, yaw: 0 };

/** Pay the cable in, take the crate up, and turn the arm with it. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 45, rate: SLEW_MAX_RATE }],
  },
];

/** How far the carried load must have travelled before the readings are taken. */
const CARRIED = 0.1;

/** Ticks the sweeps are given. */
const CAP = 400;

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

  const carried = await runUntil(
    h,
    (s) =>
      s.run.loads[0]?.phase === "attached" &&
      distance3(s.run.loads[0].pos, FROM) > CARRIED,
    CAP,
    "the run to take the crate up and carry it away from where it stands",
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
