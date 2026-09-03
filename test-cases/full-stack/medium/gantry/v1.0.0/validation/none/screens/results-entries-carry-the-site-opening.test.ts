// results — NEXT SITE and REPLAY both carry the site-opening operation.
//
// `specs/ui.md` § Results tabulates where the two entries lead — "`NEXT SITE`:
// Opens the next site and shows its `build` screen", "`REPLAY`: Opens this site
// again and shows its `build` screen" — and then says what "opens" means:
// "Opening a site is the operation `specs/state.md` fixes, so `NEXT SITE` and
// `REPLAY` both return the camera to its start pose, empty the undo history, and
// put the run back to its idle placeholder".
//
// So this check is not about arriving at the build screen; it is about the two
// entries carrying the whole operation rather than only showing the screen. The
// two effects it reads are the two `specs/state.md` fixes that a bare screen
// change would leave alone: the camera, which "persists across the three yard
// screens and returns to its start pose when a site is opened", and `history`,
// which "empties when a site is opened".
//
// BOTH ARE PUT SOMEWHERE ELSE FIRST. The camera is posed away from its start
// pose with `setCamera`, and the crane is stood up edit by edit, which is what
// fills the undo history — so a build that only showed the build screen would be
// caught by a camera still off its start pose and a history still deep.
//
// EACH ENTRY IS TAKEN THE WAY A PLAYER TAKES IT: the highlight is posed onto it
// with `setMenuIndex`, which `specs/instrumentation.md` allows on the results
// screen, and `confirm` "takes the highlighted entry" (`specs/ui.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  BINDINGS,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  GRIP_MAX_RATE,
  RESULTS_ITEMS,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One short move: enough for a tape to run out and clear an empty yard. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 30, rate: GRIP_MAX_RATE }] },
];

/** A camera pose that is none of the three start figures. */
const POSED_CAMERA = { yaw: 210, pitch: 65, dist: 22 };

/** Ticks the run is given to reach its verdict. */
const END_CAP = 600;

/** The key `confirm` is bound to (`specs/controls.md`). */
const CONFIRM = BINDINGS.confirm[0] as string;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Clear site `0` from a moved camera and a deep history, landing on results. */
async function clearSiteZero(harness: Harness): Promise<void> {
  await openSite(harness, 0);
  await clearAll(harness);
  await standMinimalCrane(harness);
  await poseTape(harness, TAPE);
  await harness.debug.setCamera(
    POSED_CAMERA.yaw,
    POSED_CAMERA.pitch,
    POSED_CAMERA.dist,
  );

  const posed = await harness.snapshot();
  assertGreaterThan(
    posed.historyDepth,
    0,
    "the undo history the edits that stood the crane up filled " +
      "(specs/state.md)",
  );
  assertTrue(
    posed.camera.yaw !== CAMERA_START_YAW ||
      posed.camera.pitch !== CAMERA_START_PITCH ||
      posed.camera.dist !== CAMERA_START_DIST,
    "the camera posed away from its start pose (specs/instrumentation.md)",
  );

  await startRun(harness);
  const ended = await runUntil(
    harness,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the tape to run out and the site to clear",
  );
  assertEqual(
    ended.screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md)",
  );
}

it("opens a site through NEXT SITE and through REPLAY", async () => {
  for (const entry of ["NEXT SITE", "REPLAY"] as const) {
    const index = RESULTS_ITEMS.indexOf(entry);
    await clearSiteZero(h);

    await h.debug.setMenuIndex(index);
    assertEqual(
      (await h.snapshot()).menuIndex,
      index,
      `the highlight posed onto ${entry} (specs/instrumentation.md)`,
    );
    await h.press(CONFIRM);

    const after = await h.snapshot();
    assertEqual(
      after.screen,
      "build",
      `the screen ${entry} shows (specs/ui.md)`,
    );
    assertEqual(
      after.camera.yaw,
      CAMERA_START_YAW,
      `the camera's yaw after ${entry}: opening a site returns the camera to ` +
        "its start pose (specs/state.md)",
    );
    assertEqual(
      after.camera.pitch,
      CAMERA_START_PITCH,
      `the camera's pitch after ${entry} (specs/state.md)`,
    );
    assertEqual(
      after.camera.dist,
      CAMERA_START_DIST,
      `the camera's distance after ${entry} (specs/state.md)`,
    );
    assertEqual(
      after.historyDepth,
      0,
      `the undo history after ${entry}: opening a site empties it ` +
        "(specs/state.md)",
    );
  }

  await h.advance(1);
  await h.capture("results-entries", "The site the last entry taken opened");
});
