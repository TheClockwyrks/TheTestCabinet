// gameplay/serve-sign-drawn — parking draws the serve sign afresh, `1` and `-1`
// each equally likely.
//
// One reading cannot show a draw: any one sign is some sign. So the draw is
// sampled through `drawBallServeSign`, the operation that performs the one draw
// parking makes and nothing else (specs/instrumentation.md), and the sign is
// read straight back off the snapshot each time. Every reading is held to the
// draw's range, `1` or `-1`, and the sample as a whole to the draw itself: both
// signs appear.
//
// The bar is the one a fixed sign cannot clear and a fair draw cannot miss:
// sixty-four draws all of one sign come up one time in 2^63 from a fair draw. A
// build that always serves upward, or always downward, fails it every time. One
// serve with the last sign drawn is recorded for the reviewer.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  endHolds,
  isolateBall,
  openCountdown,
  type Harness,
} from "../harness";

/** How many draws the sample takes. */
const DRAWS = 64;

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

it("draws the serve sign afresh, and both signs come up", async () => {
  await openCountdown(harness, "versus");
  await isolateBall(harness);

  const signs: number[] = [];
  for (let i = 0; i < DRAWS; i += 1) {
    await harness.debug.drawBallServeSign();
    const sign = ball0(await harness.snapshot()).serveSign;
    assertContains([1, -1], sign);
    signs.push(sign as number);
  }
  assertGreaterThanOrEqual(signs.filter((sign) => sign > 0).length, 1);
  assertGreaterThanOrEqual(signs.filter((sign) => sign < 0).length, 1);

  // One serve with the last sign drawn, kept for the reviewer.
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
});
