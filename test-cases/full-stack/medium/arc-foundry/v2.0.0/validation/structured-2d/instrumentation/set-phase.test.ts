// instrumentation/set-phase — `setPhase` moves the run between its phases and
// releases nothing.
//
// WHY A POSE AND NOT A UNIT. A check about what the build panel or the status bar
// does DURING A WAVE is about the phase, not about a unit, and the guide this case
// is authored to asks a validator to pose a world holding only what its
// requirement concerns. `specs/instrumentation.md` gives the operation that makes
// that possible: `setPhase` "releases no unit and composes no wave", so `"wave"`
// opens a live wave whose spawn schedule is empty "and the yard holds whatever it
// already held".
//
// THE THREE PHASES, AND WHAT EACH LEAVES BEHIND. `"wave"` puts the run mid-wave
// with `waveActive` true; `"finale"` opens the maze-rating finale; `"build"` ends
// whatever was running "without paying a wave-clear bonus and without advancing
// the wave counter". The bonus and the counter are read on the way through,
// because a build that resolved the phase change as a wave CLEAR would pay one and
// advance the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enterPhase,
  openYard,
  type Harness,
} from "../harness";

/** The wave the run is posed at: a counter a spurious clear would move. */
const WAVE = 4;

/** Charge in the bank: a figure a spurious wave-clear bonus would move. */
const BANK = 250;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses each phase without releasing a unit or paying a bonus", async () => {
  openYard(h, { wave: WAVE, charge: BANK });
  const opened = h.snapshot();
  assertEqual(opened.phase, "build", "the phase a run opens on");

  enterPhase(h, "wave");
  const wave = h.snapshot();
  assertEqual(wave.phase, "wave", 'the phase setPhase("wave") poses');
  assertEqual(
    wave.waveActive,
    true,
    'whether a wave is running once setPhase("wave") has been called',
  );
  assertLength(
    wave.units,
    0,
    'the units on the yard once setPhase("wave") has been called, which ' +
      "releases none (specs/instrumentation.md)",
  );
  assertEqual(
    wave.wave,
    WAVE,
    "the wave counter, which setPhase spends none of",
  );
  assertEqual(
    wave.charge,
    BANK,
    "the bank, which posing a phase never pays into",
  );

  enterPhase(h, "finale");
  await h.advance(1);
  captureStill(h, "phase");
  const finale = h.snapshot();
  assertEqual(finale.phase, "finale", 'the phase setPhase("finale") poses');
  assertLength(
    finale.units,
    0,
    'the units on the yard once setPhase("finale") has been called',
  );

  enterPhase(h, "build");
  const build = h.snapshot();
  assertEqual(build.phase, "build", 'the phase setPhase("build") poses');
  assertEqual(
    build.waveActive,
    false,
    'whether a wave is still running once setPhase("build") has been called',
  );
  assertEqual(
    build.wave,
    WAVE,
    'the wave counter after setPhase("build"), which advances no wave',
  );
  assertEqual(
    build.charge,
    BANK,
    'the bank after setPhase("build"), which pays no wave-clear bonus',
  );
});
