// tape/nothing-ticks-outside-a-run — with no run in progress, frames pass and
// the simulation does not advance.
//
// `specs/overview.md` § Units, ticks, and the stage: "Outside a run nothing ticks;
// menus and the editor respond to input as it arrives, and the camera moves
// against the frame's delta time." The run is the only thing that consumes ticks,
// so a build whose frame loop drives the tick pipeline unconditionally — or that
// feeds a running accumulator while the editor is showing — moves something a
// player left standing.
//
// THE READING IS THE RUN ITSELF. `specs/state.md` fixes the idle placeholder down
// to the field: phase `idle`, a zero tick, the four axes at the run-start posture
// with no command, a zero pivot, a bob at the origin with zero velocity. That is
// a complete description of what the run carries with no run in progress, so
// reading the whole of it back after a second of frames says exactly the one
// thing this point is about — nothing ticked — and nothing else.
//
// THE WORLD IS EVERYTHING A RUN WOULD NEED AND NO RUN IS STARTED. A ready crane
// stands, a tape is written, and one load waits in the yard, so a build that
// ticks outside a run has something to tick: axes to drive, a bob to drop, a
// solve to run. The check never calls `startRun`, and the frames it drives are
// the editor's own.
//
// AND THE FRAMES ARE COUNTED, NOT PILED UP. A frame loop that drives the tick
// pipeline unconditionally takes its first tick on its first frame, and a loop
// feeding an accumulator crosses one tick's worth of elapsed time on its first
// frame too, since a frame here covers exactly `1 / TICK_HZ` seconds
// (`specs/instrumentation.md`). So the reading is decided within a handful of
// frames whatever the shape of the defect, and a whole second of them is margin
// rather than the distance the scenario has to travel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  addOneLoad,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One short hoist move: a tape a run could be started on, and never is. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

/** One second of frames at TICK_HZ: sixty chances to tick. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes no simulation tick across a second of frames of the editor", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 8, y: 2, z: 0, yaw: 0 },
    { x: 0, y: 2, z: 8, yaw: 0 },
  );

  const before = await h.snapshot();
  await h.advance(FRAMES);
  const after = await h.snapshot();
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    after.run.tick,
    0,
    `run.tick after ${FRAMES} frames with no run in progress ` +
      "(specs/overview.md)",
  );
  assertEqual(
    after.run.phase,
    "idle",
    "the run's phase, which no frame outside a run starts",
  );
  assertEqual(
    JSON.stringify(after.run),
    JSON.stringify(before.run),
    `the whole run reading across ${FRAMES} frames outside a run: nothing ` +
      "ticks (specs/overview.md)",
  );
  assertEqual(
    JSON.stringify(after.site.loads),
    JSON.stringify(before.site.loads),
    "the loads standing in the yard, at the poses they were authored at",
  );
});
