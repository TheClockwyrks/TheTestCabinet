// gameplay/serve-sign-drawn — parking draws the serve sign afresh, `1` and `-1`
// each equally likely.
//
// One reading cannot show a draw: any one sign is some sign. So a small sample
// is taken through `drawBallServeSign`, the operation that performs the one draw
// parking makes and nothing else (specs/instrumentation.md), and the sign is
// read straight back off the snapshot each time. Every reading is held to the
// draw's range, `1` or `-1`, and the sample as a whole to the one thing a draw
// over two equally likely signs shows and a fixed sign cannot: the readings
// differ. Which sign comes up more often, and by how much, is the reviewer's to
// judge from the replay rather than this check's to count.
//
// The sample is small, and the bar is one a fair draw cannot miss: thirty-two
// draws all of one sign come up one time in 2^31. A build that always serves
// upward, or always downward, fails it every time. One serve with the last sign
// drawn is recorded for the reviewer.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertGreaterThan } from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  driveServe,
  openCountdown,
  poseWorld,
  stageServe,
  type Harness,
} from "../harness";

/** How many draws the sample takes. */
const DRAWS = 32;

/** Frames of the hold recorded before the serve, for the replay's context. */
const HELD_TICKS = 24; // 0.2 s
/** Frames of the flight recorded after the launch frame, for the replay. */
const FLIGHT_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws the serve sign afresh, and the draws differ", async () => {
  openCountdown(harness, "versus");
  poseWorld(harness, { live: false });

  const signs = new Set<number>();
  for (let i = 0; i < DRAWS; i += 1) {
    harness.debug.drawBallServeSign();
    const sign = ball0(harness.snapshot()).serveSign;
    assertContains([1, -1], sign);
    signs.add(sign as number);
  }
  assertGreaterThan(signs.size, 1);

  // One serve with the last sign drawn, kept for the reviewer.
  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    stageServe(harness);
    const swept = await driveServe(harness);
    await harness.advance(FLIGHT_TICKS);
    return swept;
  });
  assertEqual(launched.hit, true);
});
