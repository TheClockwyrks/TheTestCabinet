// tape/loads-unplaced — a tape that runs out with a load unplaced fails as
// `loads-unplaced`.
//
// `specs/program.md` § The tick pipeline, stage 1: "A tick that finds no live
// step and no step left to take is the tick the run ends on: cleared if every
// load is `placed`, otherwise failed as `loads-unplaced`." The site's load is
// never touched by this tape, so the tick the tape runs out on finds it still
// `waiting` and the run ends failed with that cause.
//
// THE TAPE NEVER REACHES THE LOAD, which is what makes the verdict this
// requirement's and no other's. Its one step commands the hoist to the value the
// run-start posture already stands it at, so the step is done on the tick it is
// issued (`specs/program.md` § Axis motion) and the second tick is the one that
// finds no step left: the run ends before anything can attach, strike or snap.
//
// THE YARD HOLDS ONE LOAD AND NOTHING ELSE. It stands well clear of the crane and
// of the hook, and `specs/statics.md` tests a waiting load against nothing, so
// the only thing it can do to this run is be unplaced when the tape ends.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One step, done on the tick it is issued: the tape runs out on tick 2. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  },
];

/** Where the load stands, and the pad it is wanted on: never delivered. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };
const TO = { x: -6, y: 2, z: 0, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails as loads-unplaced when the tape ends with a load still waiting", async () => {
  await openSite(h, 0);
  // Nothing is cleared here. `standMinimalCrane` empties the structure it stands,
  // `addOneLoad` empties the yard's loads before it places its own, site 1 carries
  // no obstacle (specs/sites.md), and a site opened after a reset carries an empty
  // tape. Each pose below states its own precondition, and driving the rest of the
  // clearing surface would add failure modes belonging to other validators.
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, TAPE);
  await startRun(h);

  const ended = await runTicks(h, 2);
  await h.capture(
    "state",
    "The verdict a tape that ended with a load unplaced",
  );

  assertEqual(
    ended.run.loads[0]?.phase,
    "waiting",
    "the load's phase when the tape ran out: this tape never attaches it, so " +
      "it is not placed (specs/state.md)",
  );
  assertEqual(
    ended.run.phase,
    "failed",
    "the run a tape that ends with a load unplaced reaches (specs/program.md)",
  );
  assertEqual(
    ended.run.cause,
    "loads-unplaced",
    "the cause a tick that finds no live step and no step left raises when " +
      "some load is not placed (specs/program.md)",
  );
});
