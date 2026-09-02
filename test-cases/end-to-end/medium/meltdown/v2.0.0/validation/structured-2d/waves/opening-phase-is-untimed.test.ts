// Meltdown — waves/opening-phase-is-untimed: the opening phase never starts a
// wave on its own, and its clock never runs.
//
// `specs/waves.md`, The opening phase: "The opening phase runs before Wave 1. It
// carries no countdown, reports a `buildTimer` of `0`, and never starts a wave
// on its own however long it runs. Sending is what begins Wave 1." The phase
// table in the same file gives `opening` "Surge released: None".
//
// THE WORLD GATE IS OPEN HERE, and it is the whole point. `startRun` leaves the
// run's own release of surge OFF, which would hold the build timer's automatic
// start and the spawner's release whatever the phase did
// (`specs/instrumentation.md`) — so a build that ran a countdown in the opening
// phase and started a wave off it would pass with the gate shut, and the item
// would decide nothing. With `setWaveSpawning(true)` the run's own release is
// running and the only thing standing between it and a wave is the rule under
// test.
//
// UNITS ARE POSED AS PENDING, ON A PHASE THAT QUEUES NONE. Read on an opening
// phase with nothing queued, the release half of this point would decide
// nothing: there would be nothing for a spawner to release however little it
// consulted the phase. So `wavePending` is posed to `5` — `setWavePending` "sets
// how many units of the current wave are still to be released" and poses that
// field alone (`specs/instrumentation.md`) — and `specs/waves.md`'s phase table
// is not ambiguous about what the opening phase does with them: "Surge released:
// None". A build entitled to hold its opening phase's `wavePending` at `0`
// passes just the same, because nothing here asserts that the posed figure
// stuck; the only build this fails is one whose spawner releases without asking
// which phase it is in.
//
// A MINUTE OF GAME TIME, which is four times the `BUILD_PHASE_TIME` (`15` s) a
// between-wave countdown runs for. A build that counts the opening phase down
// like a build phase has therefore had four chances to reach `0` and start a
// wave, and one that starts a wave off some longer clock of its own has had a
// minute of it.
//
// IT IS WATCHED THROUGHOUT RATHER THAN READ AT THE END, because a build that
// started a wave and cleared it would be back in a phase by the time the minute
// was up. Every sample must still read the opening phase, a timer of `0`, and an
// empty floor.
//
// WHAT EVERY WRONG MODEL READS. A build that runs the build phase's countdown in
// the opening phase reads a falling `buildTimer` at the first sample and the
// `wave` phase from fifteen seconds in; one whose spawner releases without
// asking which phase it is in reads a non-empty floor inside the first three
// seconds; one that starts Wave 1 on its own reads the `wave` phase. A
// conformant build reads `("opening", 0, 0)` at every one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BUILD_PHASE_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { watchOver } from "./run";

/** The game time the opening phase is held for: a minute. */
const WATCH_TICKS = ticksFor(60);

/** How often the phase is read, in frames: eight times a second. */
const POLL = ticksFor(1 / 8);

/** The timer the opening phase must report, from `specs/waves.md`. */
const EXPECTED_TIMER = 0;

/**
 * Units posed as still to be released, on a phase that releases none.
 *
 * Five, so a spawner that ignored the phase would have put four of them out
 * inside the first three seconds at `specs/waves.md`'s `0.6` s cadence and all
 * five inside the first three.
 */
const PENDING = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the opening phase over a minute with the run's own release running", async () => {
  startRun(h);
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(EXPECTED_TIMER);
  h.debug.setWavePending(PENDING);
  h.debug.setWaveSpawning(true);

  const samples = await watchOver(h, WATCH_TICKS, POLL, (snapshot) => ({
    phase: snapshot.phase,
    timer: snapshot.buildTimer,
    surge: snapshot.surge.length,
  }));

  captureStill(h, "opening");

  for (const [index, sample] of samples.entries()) {
    const at = `at ${seconds(index * POLL).toFixed(1)} s of game time`;
    assertEqual(sample.phase, "opening", `the phase ${at}`);
    assertEqual(
      sample.timer,
      EXPECTED_TIMER,
      `the buildTimer the opening phase reports ${at}, over ` +
        `${WATCH_TICKS / ticksFor(BUILD_PHASE_TIME)} whole build phases`,
    );
    assertEqual(sample.surge, 0, `the units on the floor ${at}`);
  }
});
