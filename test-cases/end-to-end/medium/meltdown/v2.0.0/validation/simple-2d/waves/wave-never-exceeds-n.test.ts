// waves/wave-never-exceeds-n — clearing the final wave ends the run rather than
// advancing past it.
//
// specs/waves.md, Wave numbering: "Clearing Wave `N` ends the run rather than
// advancing, so the number never passes `N`." Clearing a wave states the same
// thing from the other side: on the frame the final wave clears "the run ends in
// victory", and only otherwise does "the wave number rise by one".
//
// `N` IS THE BUILD'S OWN. It is read from `snapshot().waveCount` rather than from
// the case's table, because whether a build derives `20` waves for Containment
// Medium is `modes.containment-medium`'s point to decide. What this one asks is
// whether the build's LAST wave is where its numbering stops, on whatever number
// the build itself calls last. So a build with a wrong wave count still fails
// there and is graded here on the rule this item names.
//
// THE CLEAR IS REACHED, NOT POSED. The number rising is an effect of the wave-clear
// transition, and `setPhase` runs no entry effect (specs/instrumentation.md), so
// the run's final wave is posed at its end — `wavePending` `0`, one live unit —
// and that unit walks out through its exhaust under its own power.
//
// THE LEAK LEAVES A LIFE IN HAND. specs/modes.md opens a Containment run on `20`
// lives and specs/surge.md charges a Mote's leak `1`, so nineteen remain: the run
// ends the way specs/waves.md says a cleared final wave ends it rather than through
// the lives running out, which is a different rule and has its own point.
//
// WHAT THE NUMBER MUST READ IS `N`, NOT MERELY "AT MOST `N`". A build that resets
// the number as the run ends reads something else and is caught; a build that
// advances reads `N + 1` and is caught.
//
// WHAT EVERY WRONG MODEL READS. A build that treats the final clear like any other
// reads `N + 1` and opens a build phase; one that wraps to the first wave reads
// `1`; one that never numbers past its own count but clears into a twenty-first
// build phase is caught by `waves.victory-on-clearing-the-final-wave` instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilGone } from "./run";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the wave number at N when the final wave clears", async () => {
  startRun(h);
  const finalWave = h.snapshot().waveCount;
  assertGreaterThan(
    finalWave,
    0,
    "precondition: the build derived a wave count for the run",
  );

  poseWaveEnd(h, finalWave);
  poseLeaker(h);

  const cleared = await runUntilGone(h);
  const ended = h.snapshot();
  captureStill(h, "last");

  assertTrue(
    cleared,
    "precondition: the final wave's last unit left the floor",
  );
  assertEqual(
    ended.wave,
    finalWave,
    `the wave number after wave ${finalWave} of ${finalWave} cleared`,
  );
});
