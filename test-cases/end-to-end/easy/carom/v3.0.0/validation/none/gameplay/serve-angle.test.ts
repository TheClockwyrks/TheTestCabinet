// gameplay/serve-angle — a served ball leaves at the serve angle.
//
// specs/balls.md: the serve leaves at `SERVE_SPEED` at `SERVE_ANGLE` (12
// degrees) from horizontal, `vx = dir * SERVE_SPEED * cos(SERVE_ANGLE)` and
// `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)` with the sign `s` the build's. The
// magnitude of the angle is therefore exactly 12 degrees, whichever way it
// goes; two degrees is rounding room. The ball is not advanced on the frame it
// is served, so the launch frame reads the serve itself.
//
// Nothing about the serve is posed. `openCountdown` opens a match on its hold
// and `endHolds` runs that hold out; the LAUNCH is the build's own, on the frame
// after, and what leaves is whatever its own serve produced. The field is
// emptied to that one ball first — a serve is about the ball and its aim, and
// nothing else on the field takes any part in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { SERVE_ANGLE } from "../constants";
import {
  angleDeg,
  ball0,
  captureReplay,
  createHarness,
  endHolds,
  isolateBall,
  openCountdown,
  type Harness,
} from "../harness";

const SERVE_ANGLE_DEG = (SERVE_ANGLE * 180) / Math.PI;
const ANGLE_TOLERANCE_DEG = 2;

/** Frames of the hold recorded before the serve, for the replay's context. */
const HELD_TICKS = 24; // 0.2 s
/** Frames of the flight recorded after the launch frame, for the replay. */
const FLIGHT_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("serves the ball at SERVE_ANGLE from horizontal", async () => {
  await openCountdown(harness, "versus");
  await isolateBall(harness);

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    await endHolds(harness);

    const swept = await harness.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });
    await harness.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  assertLessThanOrEqual(
    Math.abs(angleDeg(ball0(launched.snapshot)) - SERVE_ANGLE_DEG),
    ANGLE_TOLERANCE_DEG,
  );
});
