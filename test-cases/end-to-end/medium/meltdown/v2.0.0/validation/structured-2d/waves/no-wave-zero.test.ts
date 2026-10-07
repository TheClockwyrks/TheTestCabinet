// Meltdown — waves/no-wave-zero: a run opens on Wave 1.
//
// `specs/waves.md`, Wave numbering: "A run opens on Wave 1; there is no Wave 0."
// `specs/modes.md` says the same of every mode: "A run that has just started is
// in the `opening` phase on Wave 1."
//
// THE RUN IS OPENED THE WAY A PLAYER OPENS ONE, through the real confirm on the
// difficulty menu (`waves/run.ts`, `openRun`), because "from the moment a run
// starts" is a moment that only the run's own beginning produces: `setWave`
// poses the number outright and `setPhase` runs no entry effect
// (`specs/instrumentation.md`), so a posed opening phase would be reporting the
// number this point put there. What is read is the first frame of a run the
// BUILD opened.
//
// Only the confirm is real. The screen and the highlighted row are posed, so
// this point does not walk the title and mode menus and does not fail when a row
// of one of them is wrong; `specs/screens.md`'s own points decide those.
//
// ONE READING, AND IT IS THE WHOLE REQUIREMENT. Whether the number then holds
// through the opening phase and rises on a clear are
// `waves.wave-number-holds-through-the-build-phase` and
// `waves.clearing-advances-the-wave`; what this point asks is the number a run
// starts life carrying.
//
// WHAT EVERY WRONG MODEL READS. A build numbering its waves from zero reads `0`;
// a build that carries the wave over from whatever the last run reached reads
// that number; a build that numbers the wave being prepared for as the one after
// reads `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openRun } from "./run";

/** The wave a run opens on (`specs/waves.md`). */
const FIRST_WAVE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run on Wave 1", async () => {
  await openRun(h);

  const opened = h.snapshot();
  captureStill(h, "first");

  assertEqual(opened.screen, "playing", "precondition: the run opened");
  assertEqual(
    opened.phase,
    "opening",
    "precondition: the run opened in the opening phase",
  );
  assertEqual(opened.wave, FIRST_WAVE, "the wave a run opens on");
});
