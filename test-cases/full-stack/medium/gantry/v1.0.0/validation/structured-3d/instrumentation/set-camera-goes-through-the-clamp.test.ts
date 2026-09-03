// instrumentation/set-camera-goes-through-the-clamp — setCamera commits through
// the same clamp the orbit controls use, so an out-of-range argument is held
// rather than written raw.
//
// `specs/instrumentation.md` § The run and the screens: "`setCamera(yaw, pitch,
// dist)` sets the orbit camera's pose as the orbit controls set it
// (`specs/controls.md`): the pitch and the distance are held inside their limits,
// and the yaw wraps to at or above `0` and below `360`." `specs/controls.md`
// gives the three figures: pitch `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX`
// (`80`), distance `CAMERA_DIST_MIN` (`10`) to `CAMERA_DIST_MAX` (`80`), and
// "yaw runs free and wraps, staying at or above `0` and below `360`".
//
// ALL THREE ARGUMENTS ARE OUT OF RANGE AT ONCE, each in the direction that names
// a different rule: yaw `-30` is below `0` and wraps to `330`; pitch `95` is past
// `CAMERA_PITCH_MAX` and is held at `80`; distance `200` is past
// `CAMERA_DIST_MAX` and is held at `80`. None of the three arguments is stored as
// given, which is the requirement in one direction: a build that wrote any of
// them raw fails on that one.
//
// A small tolerance, because the wrap is arithmetic a build may do in whatever
// units its camera keeps; the clamps are exact comparisons against the two
// limits.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import { CAMERA_DIST_MAX, CAMERA_PITCH_MAX } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** One argument outside each of the three rules the clamp states. */
const POSE = { yaw: -30, pitch: 95, dist: 200 };

/** `-30` wrapped to at or above `0` and below `360`. */
const WRAPPED_YAW = 330;

/** Rounding, not a spread on the figure: the arithmetic itself is exact. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds an out-of-range camera pose inside the limits", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setCamera(POSE.yaw, POSE.pitch, POSE.dist);
  const camera = (await h.snapshot()).camera;
  await h.advance(1);
  await h.capture("clamped", "The camera after an out-of-range pose");

  assertClose(
    camera.yaw,
    WRAPPED_YAW,
    TOLERANCE,
    `the yaw ${POSE.yaw} wraps to (specs/controls.md)`,
  );
  assertClose(
    camera.pitch,
    CAMERA_PITCH_MAX,
    TOLERANCE,
    `the pitch ${POSE.pitch} is held at (specs/controls.md)`,
  );
  assertClose(
    camera.dist,
    CAMERA_DIST_MAX,
    TOLERANCE,
    `the distance ${POSE.dist} is held at (specs/controls.md)`,
  );
});
