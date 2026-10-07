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
// THE WAVE CANNOT END, SO THE DEFEAT CAN ONLY BE A MID-WAVE ONE. `setWaveHold`
// holds the wave's own clear-and-pay resolution and nothing else
// (`specs/instrumentation.md`): the leak still costs its Grid Integrity and defeat
// still resolves at zero, but the wave the Mote leaked out of stays running whatever
// it left behind. So a build that waits for the wave to finish before resolving its
// defeat never gets the wave it was waiting for, and the frame this reads is
// unambiguous. Nothing is parked on the yard to achieve that: the run holds one Mote,
// which is the only thing the requirement is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openHeldWave,
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
  openHeldWave(h);

  const before = h.snapshot();
  assertEqual(before.phase, "wave", "the run is mid-wave");
  assertEqual(before.screen, "playing", "the run is still being played");
  assertEqual(
    before.waveHeld,
    true,
    "the wave's own clear-and-pay resolution to be held, so nothing but the " +
      "defeat can end this run (specs/instrumentation.md)",
  );

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
    defeated.waveHeld,
    true,
    "the wave still held open on the frame the counter emptied, so the defeat " +
      "resolved mid-wave rather than at the end of one",
  );
});
