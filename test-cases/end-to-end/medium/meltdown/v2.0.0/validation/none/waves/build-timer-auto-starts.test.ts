// waves/build-timer-auto-starts — a build timer reaching zero starts the wave by
// itself.
//
// `specs/waves.md`, A build phase: "Reaching `0` starts the wave, and sending
// starts it earlier." `specs/instrumentation.md` names that same event as one of
// the two things the world gate holds — "the build timer's automatic start of the
// next wave when it reaches `0`" — so this point is one of the few that turns the
// gate back ON, because the automatic start IS its requirement.
//
// THE TIMER IS POSED SHORT rather than driven down from `BUILD_PHASE_TIME`. One
// second is enough for the boundary to be crossed and short enough that the drive
// costs nothing, and the figure the phase OPENS at is a different clause of the
// same sentence, read by `build-timer-counts-down` and by the clear that opens a
// phase. `setBuildTimer` "sets the seconds left in the current build phase" and
// nothing else (`specs/instrumentation.md`), so posing it starts no wave: only
// the countdown reaching `0` can.
//
// THE PHASE IS WAVE 2's, a genuine between-wave build phase, so what starts is a
// wave the timer was counting down toward rather than Wave 1, which
// `waves/send-starts-wave-1` reaches by the send instead.
//
// THE SWEEP RUNS FOUR TIMES THE POSED SECOND, so a build whose countdown is as
// much as four times slow than specified still reaches `0` inside it. That
// generosity is deliberate: how FAST the timer falls is
// `waves/build-timer-counts-down`'s requirement, and a build that fails that one
// should not fail this one as well for the same defect.
//
// WHAT THIS POINT DOES NOT ASSERT. Not that a unit was released, which is
// `surge.spawn-cadence`'s and `waves/send-starts-wave-1`'s business, and not what
// the wave number does, which is `waves/clearing-advances-the-wave`'s. The one
// reading is the phase.
//
// WHAT EVERY WRONG MODEL READS. A build that only ever starts a wave on a send
// stays in `building` with its timer at or below `0`; one that starts the wave
// early reads `wave` before the second is up, which this sweep would also report
// as a pass and `waves/build-timer-counts-down` catches instead; one that stops
// its timer at `0` without starting anything stays in `building`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The between-wave phase whose timer runs out: an ordinary one. */
const WAVE = 2;

/** The seconds left on the timer when the watch opens. */
const POSED = 1;

/**
 * How long the start is waited for: four times the second posed.
 *
 * Geometry rather than a tolerance. It says how long the timer is given to reach
 * `0` and act on it, not how far a build's countdown rate may miss by — that
 * figure belongs to `waves/build-timer-counts-down`, and this window is loose on
 * purpose so one defect fails one item.
 */
const WATCH_SECONDS = POSED * 4;

/** How often the phase is sampled inside that window, in seconds of game time. */
const SAMPLE_SECONDS = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the phase to wave when the countdown runs out", async () => {
  await startRun(h);
  await h.debug.setWave(WAVE);
  await h.debug.setWaveSpawning(true);
  await h.debug.setBuildTimer(POSED);

  const opened = await h.snapshot();
  const swept = await h.coastUntil((snapshot) => snapshot.phase === "wave", {
    maxSeconds: WATCH_SECONDS,
    pollSeconds: SAMPLE_SECONDS,
  });

  await captureStill(h, "started");

  assertEqual(
    opened.phase,
    "building",
    `precondition: a between-wave build phase for Wave ${WAVE} with ${POSED} second on its timer`,
  );
  assertEqual(
    swept.snapshot.phase,
    "wave",
    `the phase ${WATCH_SECONDS} seconds after a ${POSED}-second countdown opened, with the run's own release of surge on`,
  );
});
