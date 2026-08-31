// waves/wave-advance-switch — with setWaveAdvance(false) a ball-caused
// destruction that leaves zero live targets does not fire the clearing event:
// play carries on in playing, and destructions keep scoring.
//
// specs/instrumentation.md, the driver switches: while `waveAdvance` is off
// "the clearing event does not fire. Play carries on in `playing` over an
// empty field, and destructions keep scoring."
//
// THE WORLD IS ONE TARGET AND ONE BALL, TWICE OVER. isolate() leaves both
// switches off — the held switch IS this requirement — and a second strike
// after the first shows the later destruction still scoring.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { armStrike, STRIKE_BUDGET_TICKS, totalTargets } from "./rig";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps playing and scoring through emptying destructions", async () => {
  const posed = await isolate(h);
  assertEqual(posed.waveAdvance, false, "the held switch");
  await armStrike(h, 6);

  const first = await captureReplay(h, "held-clearing", async () => {
    const swept = await h.until((s) => totalTargets(s) === 0, {
      maxTicks: STRIKE_BUDGET_TICKS,
    });
    await h.tick(20);
    return swept;
  });
  assertTrue(first.hit, "the first strike destroyed its target");
  assertEqual(
    first.snapshot.screen,
    "playing",
    "the screen on the tick the field emptied",
  );
  assertGreaterThan(first.snapshot.score, 0, "the first destruction scored");
  const carried = await h.snapshot();
  assertEqual(carried.screen, "playing", "the screen 20 ticks later");

  // A later destruction over the already-empty field still scores.
  await h.debug.clearBalls();
  await armStrike(h, 9);
  const second = await h.until((s) => totalTargets(s) === 0, {
    maxTicks: STRIKE_BUDGET_TICKS,
  });
  assertTrue(second.hit, "the second strike destroyed its target");
  assertEqual(second.snapshot.screen, "playing", "the screen after it");
  assertGreaterThan(
    second.snapshot.score,
    first.snapshot.score,
    "the second destruction kept scoring",
  );
});
