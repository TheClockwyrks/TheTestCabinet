// waves/a-fatal-leak-on-the-final-wave-loses — a leak that clears the last wave
// AND empties the lives is a loss, not a win.
//
// `specs/waves.md`, Victory and loss: "Victory is reached by clearing Wave `N`
// with at least one life left. Lives reaching `0` ends the run at once, on the
// frame it happens and whatever the phase ... A leak that takes the lives to `0`
// on the final wave therefore ends the run in loss, not in victory."
//
// THE EDGE CASE IS THAT ONE FRAME RESOLVES BOTH EVENTS AT ONCE. The last unit of
// Wave `N` reaching its exhaust clears the wave, which points at victory, and
// takes the lives to `0`, which points at loss. The specification settles the tie
// one way, and this is its own item so a grade names exactly that: a build that
// wins both of the other two items and gets this one wrong has one bug, in the
// order it resolves a single frame.
//
// EVERY PART OF THE COLLISION IS POSED DELIBERATELY. The wave is `N`, computed
// from `specs/modes.md`'s own table rather than read off the build; `wavePending`
// is `0`, so the leak is the clear; the lives are `1` against a Mote's leak of
// exactly `1` (`specs/surge.md`), so the count lands on `0` rather than below it.
// Change any one of the three and the frame stops being the one the specification
// is talking about.
//
// THE ONE READING IS THE SCREEN, and it decides both halves of the requirement at
// once: `"gameover"` is the game-over screen shown, and it is also the victory
// screen not shown, since `specs/screens.md` puts the game on exactly one screen
// at a time.
//
// WHAT EVERY WRONG MODEL READS. A build that resolves the clear first and the
// lives second reads `victory`; one that pays a victory for reaching the last wave
// at all reads `victory`; one that leaves the run playing on zero lives reads
// `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { modeFigures } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./run";

/** The wave count `specs/modes.md` gives Containment Medium: the run's `N`. */
const FINAL_WAVE = modeFigures("containment", "medium").waveCount;

/** The lives in hand, against a Mote's leak of exactly one (`specs/surge.md`). */
const LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("ends the run in loss when the final wave's last unit leaks the last life away", async () => {
  await startRun(h);
  await poseWaveEnd(h, FINAL_WAVE);
  await h.debug.setLives(LIVES);
  await poseLeaker(h);

  const opened = await h.snapshot();
  const leaked = await runUntilLeaked(h);
  const ended = await h.snapshot();

  await captureStill(h, "gameover");

  assertEqual(
    opened.wave,
    FINAL_WAVE,
    `precondition: the run stood on Wave ${FINAL_WAVE} of ${FINAL_WAVE} with nothing left to release`,
  );
  assertEqual(
    opened.lives,
    LIVES,
    `precondition: the run held ${LIVES} life going into that leak`,
  );
  assertTrue(
    leaked,
    "precondition: the final wave's last unit reached its exhaust",
  );
  assertEqual(
    ended.screen,
    "gameover",
    `the screen a leak that cleared Wave ${FINAL_WAVE} and took the lives to 0 opened`,
  );
});
