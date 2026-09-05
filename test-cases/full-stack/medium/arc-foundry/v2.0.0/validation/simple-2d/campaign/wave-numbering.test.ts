// campaign/wave-numbering — each cleared wave opens the next build phase.
//
// specs/campaign.md: "A run is a sequence of `N` levels, one per wave ... A level
// is one build phase followed by the wave it launches", the build phase "ends
// when the player commits the level's harvest ... That harvest launches the
// wave", and clearing a wave "opens the next build phase". The counter that says
// which wave is which rests at `0` before wave `1` (specs/instrumentation.md),
// and `spawnUnit` states the same thing from the other side: "A run reaches wave
// `1` before any unit of its own is released, so a unit released while the
// counter still reads `0` takes wave `1`'s health." The counter therefore names
// the wave in play, and a harvest is what raises it.
//
// Three levels are walked in order and every transition is read: `0` and `build`
// at the opening, then `n` and `wave` on each harvest, then `n` and `build` on
// each clear. A build whose harvest launches the same wave twice, or whose clear
// leaves the phase running, fails at the transition it got wrong rather than at
// the end of the run.
//
// The waves are the ones the game composed for itself, cleared through the
// emptying of `runs.ts` rather than by waiting out three waves' worth of walking.
// They stay composed waves here: the harvest raising the counter and the clear
// opening the next build phase IS the requirement, so neither end is posed.
//
// THE FRAMES THE THREE WAVES ARE CUT INTO ARE NOT THE SAMPLE. What is read at
// each transition is a phase and a counter, never a position and never a
// projectile, and the simulation is frame-division independent
// (`specs/controls.md`: "an interval of simulation time reaches the same state
// however it was divided into frames and whatever frame rate produced it"), so
// the three waves are driven at a coarse step. The same three waves are composed,
// launched, emptied and cleared; only the number of frames that takes goes.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { clearWave, harvestWave } from "./runs";

/** How many levels are walked. */
const LEVELS = 3;

/** 10 Hz: coarse, and the simulation is defined to be indifferent to it. */
const CLOCK_MS = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(CLOCK_MS) });
});

afterEach(() => {
  h.dispose();
});

it("walks waves 1 through 3 in order, a build phase between each", async () => {
  openYard(h);
  const opening = h.snapshot();
  assertEqual(opening.wave, 0, "the counter before wave 1");
  assertEqual(opening.phase, "build", "the first build phase");

  await captureReplay(h, "levels", async () => {
    for (let level = 1; level <= LEVELS; level += 1) {
      const launched = harvestWave(h, level);
      assertEqual(
        launched.waveActive,
        true,
        `wave ${level} is spawning or holds live units`,
      );

      const cleared = await clearWave(h);
      assertEqual(
        cleared.snapshot.phase,
        "build",
        `clearing wave ${level} opens the next build phase`,
      );
      assertEqual(
        cleared.snapshot.wave,
        level,
        `the counter still names wave ${level} in the build phase after it`,
      );
      assertEqual(
        cleared.snapshot.waveActive,
        false,
        `wave ${level} is no longer running`,
      );
    }
  });
});
