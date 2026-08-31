// Meltdown — waves/wave-number-holds-through-the-build-phase: the number reads
// the coming wave for the whole of the phase that prepares for it.
//
// `specs/waves.md`, Wave numbering: "The current wave number is the wave being
// prepared for or fought, so a build phase belongs to the wave that follows it
// and the number reads the same right through that phase."
//
// A WHOLE PHASE, AND THEN SOME. The countdown is posed at the phase's own
// `BUILD_PHASE_TIME` (`15`) and the number is read every eighth of a second for
// the whole of it and two seconds past the end, so a build that renumbers as its
// countdown crosses some threshold of its own, or as the timer reaches `0`, is
// caught wherever it does it. A reading taken only at the end would miss a
// number that moved and moved back.
//
// THE WORLD GATE STAYS SHUT, as `startRun` leaves it, which is what lets the
// window run past the end of the countdown at all: with it open the timer
// reaching `0` would start a wave (`waves.build-timer-auto-starts`) and the
// phase under test would be over. `specs/instrumentation.md` holds the automatic
// start and nothing else, so the countdown itself still runs exactly as it does
// in a run.
//
// WAVE `7` IS POSED, not the wave a fresh run opens on. A build that reports a
// constant `1`, or the wave just cleared rather than the one coming, or the
// number plus one, reads a different figure from `7` at every sample; on wave
// `1` several of those would agree with the rule by accident.
//
// WHAT EVERY WRONG MODEL READS. A build that numbers a build phase by the wave
// just finished reads `6`; one that adds one as the phase opens reads `8`; one
// that renumbers when the countdown runs out reads `8` from fifteen seconds in;
// one that reports a constant reads `1`.

import { afterEach, beforeEach, it } from "vitest";
import { BUILD_PHASE_TIME } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { watchOver } from "./run";

/** The wave the posed build phase prepares for: a distinguishing number. */
const WAVE = 7;

/** The game time watched: the whole countdown and two seconds past it. */
const WATCH_TICKS = ticksFor(BUILD_PHASE_TIME + 2);

/** How often the number is read, in frames: eight times a second. */
const POLL = ticksFor(1 / 8);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the coming wave at every moment of the build phase", async () => {
  startRun(h);
  h.debug.setWave(WAVE);
  h.debug.setPhase("building");
  h.debug.setBuildTimer(BUILD_PHASE_TIME);

  const samples = await watchOver(h, WATCH_TICKS, POLL, (snapshot) => ({
    wave: snapshot.wave,
    phase: snapshot.phase,
  }));

  captureStill(h, "holding");

  for (const [index, sample] of samples.entries()) {
    const at = `at ${seconds(index * POLL).toFixed(1)} s of the build phase`;
    assertEqual(sample.phase, "building", `the phase ${at}`);
    assertEqual(sample.wave, WAVE, `the wave number ${at}`);
  }
});
