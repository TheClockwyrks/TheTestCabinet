// instrumentation/set-camera-goes-through-the-clamp — setCamera wraps the yaw and
// fails loudly on a pitch or a distance outside its domain.
//
// `specs/instrumentation.md` § The run and the screens: "`setCamera(yaw, pitch,
// dist)` sets the orbit camera's pose. The pitch and the distance limits
// `specs/controls.md` fixes are constants, so they are this operation's domain
// and a value outside either fails loudly; the yaw is unbounded and wraps to at
// or above `0` and below `360`." The rule above the tables is what separates the
// three: a bound the specification fixes as a constant is a domain, and "an
// operation fails loudly on a call that names nothing … What an operation never
// does is refuse quietly", which snapping a posed value to the nearest legal one
// would be.
//
// `specs/controls.md` gives the three figures: pitch `CAMERA_PITCH_MIN` (`10`) to
// `CAMERA_PITCH_MAX` (`80`), distance `CAMERA_DIST_MIN` (`10`) to
// `CAMERA_DIST_MAX` (`80`), and "yaw runs free and wraps, staying at or above `0`
// and below `360`".
//
// EACH ARGUMENT IS TRIED IN THE DIRECTION THAT NAMES ITS OWN RULE, one at a time,
// because they fail differently: yaw `-30` is below `0` and must WRAP to `330`,
// pitch `95` is past `CAMERA_PITCH_MAX` and must RAISE, and distance `200` is
// past `CAMERA_DIST_MAX` and must raise too. A build that clamped instead of
// raising leaves the camera at the limit and reports no error, which is what the
// camera reading after each refused call separates out: a call that fails reaches
// nothing, so the camera is still the one the wrapping call left.
//
// A small tolerance on the wrap, because it is arithmetic a build may do in
// whatever units its camera keeps.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { CAMERA_DIST_MAX, CAMERA_PITCH_MAX } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A yaw below `0`, and a pitch and a distance inside their domains. */
const WRAPPING = { yaw: -30, pitch: 40, dist: 30 };

/** `-30` wrapped to at or above `0` and below `360`. */
const WRAPPED_YAW = 330;

/** One argument past each constant bound, tried on its own. */
const PAST_PITCH = CAMERA_PITCH_MAX + 15;
const PAST_DIST = CAMERA_DIST_MAX + 120;

/** Rounding, not a spread on the figure: the arithmetic itself is exact. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the yaw and fails loudly past the pitch and distance bounds", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setCamera(WRAPPING.yaw, WRAPPING.pitch, WRAPPING.dist);
  const wrapped = (await h.snapshot()).camera;

  const raised: boolean[] = [];
  for (const [pitch, dist] of [
    [PAST_PITCH, WRAPPING.dist],
    [WRAPPING.pitch, PAST_DIST],
  ] as const) {
    let threw = false;
    try {
      await h.debug.setCamera(WRAPPING.yaw, pitch, dist);
    } catch {
      threw = true;
    }
    raised.push(threw);
  }
  const after = (await h.snapshot()).camera;
  await h.advance(1);
  await h.capture("clamped", "The camera an out-of-domain pose could not move");

  assertClose(
    wrapped.yaw,
    WRAPPED_YAW,
    TOLERANCE,
    `the yaw ${WRAPPING.yaw} wraps to: the yaw is unbounded and runs free ` +
      "(specs/controls.md)",
  );
  assertEqual(
    raised[0],
    true,
    `setCamera with a pitch of ${PAST_PITCH} to fail loudly: the pitch limits ` +
      "are constants, so they are the operation's domain " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    raised[1],
    true,
    `setCamera with a distance of ${PAST_DIST} to fail loudly, for the same ` +
      "reason (specs/instrumentation.md)",
  );
  assertClose(
    after.pitch,
    WRAPPING.pitch,
    TOLERANCE,
    "the pitch after the two refused calls: a call that fails reaches nothing " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    after.dist,
    WRAPPING.dist,
    TOLERANCE,
    "the distance after the two refused calls, for the same reason " +
      "(specs/instrumentation.md)",
  );
});
