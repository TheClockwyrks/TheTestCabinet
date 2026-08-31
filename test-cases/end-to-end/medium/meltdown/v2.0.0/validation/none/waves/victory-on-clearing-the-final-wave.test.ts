// waves/victory-on-clearing-the-final-wave — clearing the last wave with a life
// left wins the run.
//
// `specs/waves.md`, Victory and loss: "Victory is reached by clearing Wave `N`
// with at least one life left." Clearing a wave says where it shows: "If the wave
// cleared was Wave `N`, the run ends in victory, and the victory screen opens."
//
// THE VICTORY IS REACHED, NOT POSED. `specs/instrumentation.md` has `setScreen`
// set that field alone and run no entry effect, so a posed `victory` screen would
// grade nothing; the run is stood at the end of its final wave and that wave's
// last unit is then leaked away, which `specs/waves.md` makes a clear like any
// other.
//
// THE READING IS THE SCREEN ALONE. Whether the wave number stopped at `N` is
// `waves/wave-never-exceeds-n`'s requirement and whether the victory paid its
// score is `economy.victory-score-bonus`'s; keeping them apart is what lets a
// grade say which of the three a build got wrong.
//
// `N` COMES FROM THE SPECIFICATION'S TABLE, not from the build:
// `specs/modes.md` gives Containment Medium twenty waves.
//
// FIVE LIVES ARE IN HAND, which is the "at least one life left" clause held well
// clear of its boundary. The leaked Mote costs one (`specs/surge.md`), leaving
// four, so this scenario cannot stray into the loss that
// `waves/a-fatal-leak-on-the-final-wave-loses` reads at the very same transition
// — and five is nothing like the twenty a run starts with, so no build passes by
// ignoring the count.
//
// WHAT EVERY WRONG MODEL READS. A build that opens a twenty-first build phase
// reads `playing`; one that treats a leak on the last wave as a loss reads
// `gameover`; one that only wins when the last wave is cleared without a leak
// reads `playing` too, and is told apart from the first by the wave number
// `waves/wave-never-exceeds-n` reads.

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

/** The lives in hand: the "at least one" clause, well clear of its boundary. */
const LIVES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the victory screen when the final wave clears with lives in hand", async () => {
  await startRun(h);
  await poseWaveEnd(h, FINAL_WAVE);
  await h.debug.setLives(LIVES);
  await poseLeaker(h);

  const opened = await h.snapshot();
  const leaked = await runUntilLeaked(h);
  const ended = await h.snapshot();

  await captureStill(h, "victory");

  assertEqual(
    opened.wave,
    FINAL_WAVE,
    `precondition: the run stood on its final wave, Wave ${FINAL_WAVE}, with ${LIVES} lives`,
  );
  assertTrue(
    leaked,
    "precondition: the final wave's last unit left the floor, clearing it",
  );
  assertEqual(
    ended.screen,
    "victory",
    `the screen the clear of Wave ${FINAL_WAVE} of ${FINAL_WAVE} opened, with lives still in hand`,
  );
});
