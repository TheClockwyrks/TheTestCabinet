// instrumentation/overlay-read-only — a game watched through the overlay ends
// exactly where it stood before the overlay was shown.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics): "keep
// every source a pure read, so watching the overlay leaves the game as it is".
//
// THE READ IS BEFORE AND AFTER ON ONE SESSION. A busy scene — a ball in
// flight, targets it can reach, a falling pod, a running pierce timer, the
// shield, a posed pod outcome — is posed and then held on the `paused` screen,
// where specs/screens.md keeps the field "exactly as the tick that paused it
// left it" and a tick advances nothing but the tick counter. The overlay is
// shown, the panel reports over a stretch of ticks, and the overlay is hidden;
// the snapshots on either side must agree on everything but `ticks`, which the
// frozen screen still counts. Any other difference is the overlay writing into
// the game.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { pressToggle } from "./overlay";

/** The stretch the overlay watches, in ticks; each toggle costs one more. */
const WATCH_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the watched game exactly as it stood", async () => {
  await isolate(h);
  await h.debug.spawnTarget(1, 2, 1);
  await h.debug.spawnTarget(2, 5, 2);
  await spawnBallPolar(h, 250, 180, 300, 45);
  await spawnPodPolar(h, "widen", 420, 300);
  await h.debug.setEffectTicks("pierce", 200);
  await h.debug.setShield(true);
  await h.debug.setNextPod("shield");
  await h.debug.setScreen("paused");

  const before = await h.snapshot();
  await pressToggle(h);
  await captureReplay(h, "watched", () => advanceTicks(h, WATCH_TICKS));
  await pressToggle(h);
  const after = await h.snapshot();

  assertEqual(
    after.ticks,
    before.ticks + WATCH_TICKS + 2,
    "ticks counted on the frozen screen, the two toggle presses included",
  );
  assertDeepEqual(
    { ...after, ticks: before.ticks },
    before,
    "the snapshot after the watched stretch against the one before it",
  );
});
