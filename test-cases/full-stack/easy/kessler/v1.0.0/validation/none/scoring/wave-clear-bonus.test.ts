// scoring/wave-clear-bonus — the clearing event on wave w raises the score by
// exactly 500 * w.
//
// specs/scoring.md: "The clearing event's bonus is `500` times the number of
// the wave just cleared, so clearing wave `1` awards `500` and clearing wave
// `3` awards `1500`" — and, in the same file, "The destruction that clears the
// wave awards its own destroy figure and the bonus on the same tick", so the
// increment the clearing tick shows is the destroy figure plus the bonus. The
// bonus is read at wave 1 and at wave 3 over the same ring 1 destruction
// (destroy figure 100 both times), so the two totals differ exactly by the
// bonus scaling: 500 * 1 against 500 * 3.
//
// THE WORLD IS ONE LAST TARGET AND ONE BALL, with waveAdvance turned back on:
// the destruction leaves zero live targets, so it IS the clearing event.
// podSpawn stays off so the replay holds nothing but the clearing.

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

const RING = 1;
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One lone ring 1 target on wave `wave`, a ball at its gate, clearing armed. */
async function stageLoneClear(hh: Harness, wave: number): Promise<void> {
  await stageCarried(hh);
  await hh.debug.setWaveAdvance(true);
  await hh.debug.setWave(wave);
  await armTarget(hh, RING, SLOT, 1);
  await ballAtFaceGate(hh, RING, SLOT);
}

it("awards 500 for clearing wave 1", async () => {
  await stageLoneClear(h, 1);

  const swept = await captureReplay(h, "clear-wave-1", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + DESTROY_POINTS[RING - 1] + waveClearBonus(1),
    "the clearing tick's score on wave 1: the destroy figure plus 500 * 1",
  );
});

it("awards 1500 for clearing wave 3", async () => {
  await stageLoneClear(h, 3);

  const swept = await captureReplay(h, "clear-wave-3", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + DESTROY_POINTS[RING - 1] + waveClearBonus(3),
    "the clearing tick's score on wave 3: the destroy figure plus 500 * 3",
  );
});
