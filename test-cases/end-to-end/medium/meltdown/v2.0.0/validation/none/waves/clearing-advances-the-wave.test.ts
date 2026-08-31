// waves/clearing-advances-the-wave — the wave number rises by one on the clear.
//
// `specs/waves.md`, Wave numbering: "The number rises by one when a wave clears,
// never when one is released." Clearing a wave: "the wave number rises by one and
// a build phase for the next wave begins".
//
// THE NUMBER IS READ ACROSS THE TRANSITION AND NOWHERE ELSE. The wave is posed at
// its end rather than released, so no release happens in this scenario at all and
// the only event the number could answer is the clear. That is what lets this
// point assert a rise of exactly one without also grading the "never when one is
// released" half, which a scenario that released a wave would entangle with the
// spawner.
//
// WAVE 3 IS POSED, NOT WAVE 1, so the figure read after the clear is `4`. A build
// that clears to a hardcoded `2`, or that resets the number, or that reads the
// number off the count of waves already fought, all land somewhere other than `4`
// — where a run posed on Wave 1 would let several of them pass by luck.
//
// THE CLEAR IS A LEAK rather than a kill, so the transition is reached without a
// tower or a shot: whether a wave clears at all is
// `waves/wave-clears-when-the-last-unit-goes`'s and `waves/a-leak-also-clears`'s
// requirement, and this point wants the cheapest of the two routes to it.
//
// WAVE 3 OF A TWENTY-WAVE RUN IS FAR FROM THE LAST, so `specs/waves.md`'s
// "Clearing Wave `N` ends the run rather than advancing" is not in play here;
// `waves/wave-never-exceeds-n` reads that boundary on its own.
//
// WHAT EVERY WRONG MODEL READS. A build that advances on the release rather than
// the clear reads `3` still, because nothing was released; one that never
// advances reads `3`; one that advances by two reads `5`; one that restarts the
// count reads `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./run";

/** The wave cleared, and the number the clear must leave behind. */
const WAVE = 3;
const EXPECTED = WAVE + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads one higher after a wave clears", async () => {
  await startRun(h);
  await poseWaveEnd(h, WAVE);
  await poseLeaker(h);

  const opened = await h.snapshot();
  const leaked = await runUntilLeaked(h);
  const advanced = await h.snapshot();

  await captureStill(h, "advanced");

  assertEqual(
    opened.wave,
    WAVE,
    `precondition: the run stood on Wave ${WAVE} with nothing left to release`,
  );
  assertTrue(
    leaked,
    "precondition: the wave's last unit left the floor, clearing the wave",
  );
  assertEqual(
    advanced.wave,
    EXPECTED,
    `the wave number after Wave ${WAVE} cleared`,
  );
});
