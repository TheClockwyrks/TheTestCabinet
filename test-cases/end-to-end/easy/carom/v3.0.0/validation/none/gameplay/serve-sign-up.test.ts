// gameplay/serve-sign-up — a serve whose `serveSign` is `-1` leaves upward.
//
// specs/balls.md: the serve leaves with `vy = serveSign * SERVE_SPEED *
// sin(SERVE_ANGLE)`, and `serveSign` is the ball's own field, drawn afresh when
// the ball is parked and posed by `setBallServeSign`. Posing it `-1` therefore
// fixes the draw, and the serve that follows leaves with `vy < 0`, upward on
// screen. The sign is posed AFTER the field is arranged, because spawning the
// ball parks it and parking draws the sign afresh.
//
// Nothing about the serve itself is posed: the hold is cut to zero, and the
// LAUNCH is the build's own on the frame after. The field holds that one ball
// and nothing else, so the recorded flight crosses an empty court.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  endHolds,
  isolateBall,
  openCountdown,
  type Harness,
} from "../harness";

/** The sign posed, and the vertical direction the serve must then take. */
const POSED_SIGN = -1;

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

it("serves upward when the ball's serve sign is posed -1", async () => {
  await openCountdown(harness, "versus");
  await isolateBall(harness);
  await harness.debug.setBallServeSign(POSED_SIGN);
  assertEqual(ball0(await harness.snapshot()).serveSign, POSED_SIGN);

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
  assertLessThan(ball0(launched.snapshot).vy, 0);
});
