// waves/wave-never-exceeds-n — the wave number never passes the run's wave count.
//
// `specs/waves.md`, Wave numbering: "Clearing Wave `N` ends the run rather than
// advancing, so the number never passes `N`." Clearing a wave states the same
// boundary from the other side: "If the wave cleared was Wave `N`, the run ends in
// victory ... Otherwise the wave number rises by one".
//
// SO THIS IS THE EXCEPTION TO `waves/clearing-advances-the-wave`, and it is its
// own item precisely because a build that advances on every clear passes that one
// and fails this one — which is exactly the grade a reviewer wants: the rise is
// right, the boundary is not. The reading here is the NUMBER alone; that the run
// ends in victory is `waves/victory-on-clearing-the-final-wave`'s requirement, and
// the two are deliberately separate so a build that stops the number but shows no
// victory screen, or the reverse, is told apart.
//
// `N` IS COMPUTED FROM THE SPECIFICATION'S OWN TABLE. `specs/modes.md` gives
// Containment Medium twenty waves, and `modeFigures` restates that table here, so
// the boundary tested is the one the specification fixes rather than the one the
// build believes it has.
//
// THE CLEAR IS REACHED, NOT POSED, by leaking the final wave's last unit away
// from a `wave` phase posed with nothing left to release. The run holds five
// lives going in, so the Mote's single leaked life (`specs/surge.md`) leaves four
// — comfortably clear of the zero that `specs/waves.md` says would end the run in
// loss instead, which `waves/a-fatal-leak-on-the-final-wave-loses` owns.
//
// WHAT EVERY WRONG MODEL READS. A build that advances on every clear reads `21`;
// one that wraps back to the start reads `1`; one that keeps counting into a
// twenty-first wave reads `21` and goes on releasing. Each is a different number
// from `20`.

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

/**
 * The lives the run holds going into that clear.
 *
 * Enough that the one life a leaked Mote costs cannot take the run to `0`, which
 * would end it in loss rather than victory and be a different item's event
 * entirely; low enough to be nothing like the twenty a run starts with, so no
 * build passes by leaving the count where it found it.
 */
const LIVES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("stops the wave number at the run's wave count", async () => {
  await startRun(h);
  await poseWaveEnd(h, FINAL_WAVE);
  await h.debug.setLives(LIVES);
  await poseLeaker(h);

  const opened = await h.snapshot();
  const leaked = await runUntilLeaked(h);
  const ended = await h.snapshot();

  await captureStill(h, "last");

  assertEqual(
    opened.wave,
    FINAL_WAVE,
    `precondition: the run stood on its final wave, Wave ${FINAL_WAVE}`,
  );
  assertTrue(
    leaked,
    "precondition: the final wave's last unit left the floor, clearing it",
  );
  assertEqual(
    ended.wave,
    FINAL_WAVE,
    `the wave number after Wave ${FINAL_WAVE} of ${FINAL_WAVE} cleared`,
  );
});
