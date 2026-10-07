// campaign/defeat-at-zero — Grid Integrity reaching zero ends the run at once.
//
// specs/economy.md: "Grid Integrity reaching `0` or below ends the run in defeat
// immediately, even mid-wave." specs/campaign.md's outcome table says the same
// and names what follows: "Defeat — Grid Integrity reaches `0`, at any point,
// including mid-wave. The defeat screen, immediately." specs/ui.md's screen for
// that is `overload`.
//
// The word this check is about is IMMEDIATELY. The run is posed one Grid
// Integrity from the end, mid-wave, with another unit still walking, and one Mote
// is walked into the collector. Its leak of `1` takes the counter to `0`, and the
// screen is read on the frame it grounds out rather than at the end of the wave:
// a build that waits for the wave to finish before resolving its defeat plays on
// past the frame this reads.
//
// THE WAVE IS STILL RUNNING WHEN THE COUNTER EMPTIES. `setPhase("wave")` opens a
// live wave whose spawn schedule is empty, and `setWaveHold` holds that wave's
// own clear-and-pay resolution, so the wave is still running on the frame the
// leak lands even though the leaking Mote was the only unit on the yard. That is
// what makes this a mid-wave defeat rather than the end of a wave that happened
// to also be the end of the run — and it is posed with the run's own gates rather
// than by parking a second unit somewhere harmless, whose containment would be a
// defect belonging to another check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  enterWave,
  openYard,
  type Harness,
} from "../harness";
import { leakOne } from "./runs";

/** One short of the end: a Mote's leak of `1` takes it to `0`. */
const INTEGRITY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts the run on the overload screen the frame a leak empties the counter", async () => {
  openYard(h, { wave: 4, integrity: INTEGRITY });
  enterWave(h);

  const before = h.snapshot();
  assertEqual(before.phase, "wave", "the run is mid-wave");
  assertEqual(before.waveActive, true, "a wave of the run is running");
  assertEqual(before.screen, "playing", "the run is still being played");

  const defeated = await captureReplay(h, "overload", () => leakOne(h, "mote"));

  assertLessThanOrEqual(
    defeated.integrity,
    0,
    "the leak took Grid Integrity to zero",
  );
  assertEqual(
    defeated.screen,
    "overload",
    "the frame the counter emptied, the run is on the defeat screen",
  );
  assertEqual(
    defeated.wave,
    before.wave,
    "the wave counter on the frame the counter emptied: the wave the run was " +
      "in never cleared, so this is the mid-wave defeat specs/economy.md " +
      "states rather than the end of a wave that happened to end the run",
  );
});
