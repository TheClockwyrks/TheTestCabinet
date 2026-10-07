// instrumentation/set-phase — `setPhase` moves the run between its phases and does
// nothing else.
//
// `specs/instrumentation.md`: "`setPhase` moves the run between its three phases
// and does nothing else. It releases no unit and composes no wave, so `"wave"`
// opens a live wave whose spawn schedule is empty exactly as `spawnUnit` does —
// `waveActive` reads `true`, the driver's hold on the spawner engages, and the yard
// holds whatever it already held. `"build"` ends whatever phase is running without
// paying a wave-clear bonus and without advancing the wave counter, and `"finale"`
// opens the maze-rating finale. It spends no wave number."
//
// WHY IT IS A POINT OF ITS OWN. Six other checks in this project are about what the
// wave phase changes — which controls go inert, what the bar reads, whether a
// combine is still offered — and each of them poses the phase with this operation
// rather than releasing a unit it would then have to keep quiet. A build whose
// `setPhase` releases a unit, pays a bonus, or spends a wave number sends all six
// off to measure something else, so it is decided here by name.
//
// THE HOLD IS SEPARATE. A wave with nothing left to release and nothing on the yard
// clears on the next advance, so the hold is engaged before the phase is posed and
// the two are read apart: what is decided here is the phase, not the hold.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enterBuild,
  enterWave,
  holdWave,
  openYard,
  standComponent,
  ticks,
  type Harness,
} from "../harness";

/** The wave the run is posed at, so a spent wave number would be visible. */
const WAVE = 3;

/** A bank a wave-clear bonus would visibly land in. */
const CHARGE = 100;

/** Where the standing component sits: clear of the chain. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens and closes a phase without releasing, paying, or spending a wave", async () => {
  openYard(h, { wave: WAVE, charge: CHARGE });
  const standing = standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  holdWave(h);

  const before = h.snapshot();
  assertEqual(before.phase, "build", "the phase a run opens on");

  // Into a live wave, with nothing released into it.
  enterWave(h);
  await h.advance(ticks(1));
  const live = h.snapshot();
  captureStill(h, "phase");
  assertEqual(live.phase, "wave", "the phase setPhase('wave') poses");
  assertEqual(
    live.waveActive,
    true,
    "a live wave, whose spawn schedule setPhase leaves empty " +
      "(specs/instrumentation.md)",
  );
  assertEqual(live.units.length, 0, "the units setPhase released");
  assertEqual(live.wave, WAVE, "the wave counter setPhase spent");
  assertEqual(live.charge, CHARGE, "the Charge setPhase paid");
  assertEqual(
    live.structures.length,
    before.structures.length,
    "the structures on the yard, which setPhase leaves as they stand",
  );
  assertEqual(
    live.structures[0]!.id,
    standing,
    "the structure that was standing before the phase was posed",
  );

  // And back to a build phase, without the bonus a real clear would pay.
  enterBuild(h);
  await h.advance(ticks(1));
  const built = h.snapshot();
  assertEqual(built.phase, "build", "the phase setPhase('build') poses");
  assertEqual(
    built.waveActive,
    false,
    "a wave still running after setPhase('build') ended it",
  );
  assertEqual(
    built.wave,
    WAVE,
    "the wave counter setPhase('build') advanced (specs/instrumentation.md)",
  );
  assertEqual(
    built.charge,
    CHARGE,
    "the Charge setPhase('build') paid, which is nothing: a wave-clear bonus " +
      "is paid by a wave that clears (specs/campaign.md)",
  );
});
