// controls/camera-persists-across-the-yard-screens — one camera pose serves the
// build, program and run screens.
//
// `specs/controls.md` § The camera: "The camera pose persists across the three
// screens and resets to the start pose when a site is opened." The three are the
// ones named at the top of that section — "The build, program, and run screens
// show the 3D yard through an orbit camera" — so the pose a player leaves the
// build screen with is the pose the program screen and the run show the yard
// from.
//
// THE POSE IS NONE OF THE START FIGURES. `CAMERA_START_YAW` (`45`),
// `CAMERA_START_PITCH` (`30`) and `CAMERA_START_DIST` (`40`) are what a site
// opening leaves, so a build that quietly re-poses the camera on every screen
// change would be indistinguishable from a conforming one if the check read the
// start pose back. Yaw `120`, pitch `50` and distance `25` are each well clear of
// their limits, so no clamp can produce them either.
//
// THE THREE SCREENS ARE REACHED THE WAY THE SURFACE REACHES THEM: `setScreen`
// "shows a named screen and sets nothing else", and the run screen comes from
// `startRun`, which poses the `run` action with "the same refusals ... and the
// same move to the run screen" (`specs/instrumentation.md`) — so it is a real run
// showing the yard rather than a posed screen. That needs a structure with no
// readiness issue and a tape that is not empty, which is what the minimal crane
// and a one-command tape are here for; neither is what the check reads.
//
// The yard is emptied first, so nothing standing in it bears on the reading, and
// the camera is posed after the crane and the tape so that no edit sits between
// the pose and the screens it is read on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A pose no start figure and no limit can produce. */
const YAW = 120;
const PITCH = 50;
const DIST = 25;

/** The shortest tape that makes a run start: one command on one axis. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the same camera pose on the build, program and run screens", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await h.debug.setCamera(YAW, PITCH, DIST);
  await h.advance(1);

  const built = await h.snapshot();
  assertEqual(built.screen, "build", "the screen the pose is set on");
  assertEqual(built.camera.yaw, YAW, "the camera yaw on the build screen");
  assertEqual(
    built.camera.pitch,
    PITCH,
    "the camera pitch on the build screen",
  );
  assertEqual(
    built.camera.dist,
    DIST,
    "the camera distance on the build screen",
  );

  await h.debug.setScreen("program");
  await h.advance(1);
  const programmed = await h.snapshot();
  assertEqual(programmed.screen, "program", "the screen the pose is read on");
  assertEqual(
    programmed.camera.yaw,
    YAW,
    "the camera yaw on the program screen, which the pose persists across " +
      "(specs/controls.md)",
  );
  assertEqual(
    programmed.camera.pitch,
    PITCH,
    "the camera pitch on the program screen, which the pose persists across " +
      "(specs/controls.md)",
  );
  assertEqual(
    programmed.camera.dist,
    DIST,
    "the camera distance on the program screen, which the pose persists " +
      "across (specs/controls.md)",
  );

  const running = await startRun(h);
  await h.advance(1);
  await h.capture(
    "state",
    "the run screen at the pose the build screen was left in",
  );

  assertEqual(running.screen, "run", "the screen a started run shows");
  assertEqual(
    running.camera.yaw,
    YAW,
    "the camera yaw on the run screen, which the pose persists across " +
      "(specs/controls.md)",
  );
  assertEqual(
    running.camera.pitch,
    PITCH,
    "the camera pitch on the run screen, which the pose persists across " +
      "(specs/controls.md)",
  );
  assertEqual(
    running.camera.dist,
    DIST,
    "the camera distance on the run screen, which the pose persists across " +
      "(specs/controls.md)",
  );
});
