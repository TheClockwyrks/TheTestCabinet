// scoring/clearing-destruction-awards-both — the destruction that clears a
// wave awards its ring's destroy figure and the wave-clear bonus on the same
// tick.
//
// specs/scoring.md: "The destruction that clears the wave awards its own
// destroy figure and the bonus on the same tick." The sweep stops on the FIRST
// tick the score changes at all, and that very snapshot must already read
// CARRIED + 200 + 1000: a build that stages the bonus a tick behind the
// destroy figure shows only the 200 there and fails, and a build that swallows
// either award fails on the same number. Ring 2 on wave 2 keeps the two
// figures distinct from each other and from their sum.
//
// THE WORLD IS ONE LAST TARGET AND ONE BALL, with waveAdvance turned back on
// so the destruction is the clearing event, and podSpawn off so nothing else
// rides the tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { DESTROY_POINTS, waveClearBonus } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  CARRIED,
  SWEEP_TICKS,
  armTarget,
  ballAtFaceGate,
  scored,
  stageCarried,
} from "./pose";

const RING = 2;
const SLOT = 0;
const WAVE = 2;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("awards the destroy figure and the bonus on the clearing tick itself", async () => {
  await stageCarried(h);
  await h.debug.setWaveAdvance(true);
  await h.debug.setWave(WAVE);
  await armTarget(h, RING, SLOT, 1);
  await ballAtFaceGate(h, RING, SLOT);

  const swept = await captureReplay(h, "clear", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + DESTROY_POINTS[RING - 1] + waveClearBonus(WAVE),
    "both awards already present on the first tick the score moves",
  );
});
