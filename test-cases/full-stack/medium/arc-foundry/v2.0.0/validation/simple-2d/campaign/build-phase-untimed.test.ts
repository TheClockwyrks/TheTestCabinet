// campaign/build-phase-untimed — the build phase waits on the player.
//
// specs/campaign.md: "The build phase is untimed. It shows no countdown, it never
// starts a wave on its own, and the Load waits." The phase ends one way only:
// "when the player commits the level's harvest ... That harvest launches the
// wave", and there is no send control anywhere in the game.
//
// So a run is opened and simply left running for a minute of simulation with no
// harvest committed, and the three things a timer would move are read: the
// phase, the wave counter and the yard. A build that starts its first wave on a
// countdown fails here after however many seconds that countdown was, whatever
// the number was.
//
// The minute is driven as real frames through the game's own update, so
// everything else in the game runs while it passes; what is being read is that
// nothing in the game turned that time into a wave.
//
// THE MINUTE IS THE SAMPLE; THE FRAMES IT IS CUT INTO ARE NOT. What this point
// asserts is that sixty seconds of simulation start no wave, and the simulation
// is frame-division independent (`specs/controls.md`: "an interval of simulation
// time reaches the same state however it was divided into frames and whatever
// frame rate produced it"), so the minute is driven at a coarse step. Nothing
// read across it is positional and no projectile is in flight — the yard is
// empty — so the one step size this project has to respect does not arise.
//
// WHAT IS KEPT DENSE IS THE SAMPLING, IN SIMULATION TERMS. The phase and the
// counter are read every `0.2` seconds of simulation, so a wave that started AND
// cleared inside the minute is caught rather than stepped over. The counter is a
// latch either way — clearing a wave leaves it naming that wave — but the phase
// is not, so the poll stays where a jump would have missed it.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** 10 Hz: coarse, and the simulation is defined to be indifferent to it. */
const HZ = 10;

/** That frame, in milliseconds. */
const CLOCK_MS = 1000 / HZ;

/** Sixty seconds of simulation, in seconds. */
const WAIT = 60;

/** Frames between two readings of the phase: `0.2` seconds of simulation. */
const POLL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(CLOCK_MS) });
});

afterEach(() => {
  h.dispose();
});

it("starts no wave over a minute of simulation with no harvest committed", async () => {
  openYard(h);
  const opening = h.snapshot();
  assertEqual(opening.phase, "build", "the run opens on a build phase");
  assertEqual(opening.wave, 0, "the counter before wave 1");

  const waited = await captureReplay(h, "wait", async () => {
    // Sampled rather than jumped, so a wave that started and cleared inside the
    // minute is caught rather than passed over.
    let started: string | null = null;
    for (let n = 0; n < WAIT * HZ; n += POLL) {
      await h.advance(POLL);
      const s = h.snapshot();
      if (s.phase !== "build" && started === null) started = String(s.phase);
      if (s.wave !== 0 && started === null) started = `wave ${s.wave}`;
    }
    return { started, snapshot: h.snapshot() };
  });

  assertEqual(
    waited.started,
    null,
    `the phase to stay \`build\` and the counter to stay 0 across ${WAIT} ` +
      "seconds of simulation",
  );
  assertEqual(waited.snapshot.phase, "build", "still the build phase");
  assertEqual(waited.snapshot.wave, 0, "still before wave 1");
  assertEqual(waited.snapshot.waveActive, false, "no wave ever ran");
  assertLength(waited.snapshot.units, 0, "the Load waited");
});
