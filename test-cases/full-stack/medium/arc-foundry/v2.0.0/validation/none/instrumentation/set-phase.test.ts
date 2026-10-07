// instrumentation/set-phase — posing the run's phase moves the phase and nothing
// else.
//
// THE REQUIREMENT. `specs/instrumentation.md`: "`setPhase` moves the run between
// its three phases and does nothing else. It releases no unit and composes no
// wave, so `"wave"` opens a live wave whose spawn schedule is empty exactly as
// `spawnUnit` does ... and the yard holds whatever it already held. `"build"` ends
// whatever phase is running without paying a wave-clear bonus and without
// advancing the wave counter ... It spends no wave number."
//
// WHY IT IS ITS OWN POINT. Every check in this project that is about a rule the
// PHASE decides — the press control's refusal during a wave, what the bar reads,
// what the panel offers — reaches its phase through this operation, so a build
// that released a unit here, or that spent a wave number, would make each of them
// report a defect that belongs to this one.
//
// HOW IT IS DECIDED. A run is opened on a posed yard holding one structure, and
// the phase is moved into `wave` and back to `build`. Four things are read at each
// step: the phase itself, the wave counter, the Charge, and what the yard holds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";

/** An anchor clear of the Substation's chain, its entry and its collector. */
const ANCHOR = { col: 10, row: 0 };

/** The wave the run is posed at, and the bank it is posed with. */
const WAVE = 4;
const BANK = 250;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens and ends a wave without releasing a unit or spending a wave", async () => {
  await openYard(h, { wave: WAVE, charge: BANK });
  await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);

  const building = await h.snapshot();
  assertEqual(building.phase, "build", "the phase a run opens on");

  await h.debug.setPhase("wave");
  await captureStill(h, "phase");
  const live = await h.snapshot();
  assertEqual(
    live.phase,
    "wave",
    'the phase after setPhase("wave") (specs/instrumentation.md)',
  );
  assertLength(
    live.units,
    0,
    'the units on the yard after setPhase("wave"), which releases none ' +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    live.wave,
    WAVE,
    'the wave counter after setPhase("wave"), which spends no wave number ' +
      "(specs/instrumentation.md)",
  );
  assertLength(
    live.structures,
    1,
    "the structures on the yard after setPhase, which holds whatever it held " +
      "(specs/instrumentation.md)",
  );

  await h.debug.setPhase("build");
  const back = await h.snapshot();
  assertEqual(
    back.phase,
    "build",
    'the phase after setPhase("build") (specs/instrumentation.md)',
  );
  assertEqual(
    back.wave,
    WAVE,
    'the wave counter after setPhase("build"), which does not advance it ' +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    back.charge,
    BANK,
    'the Charge after setPhase("build"), which pays no wave-clear bonus ' +
      "(specs/instrumentation.md)",
  );
});
