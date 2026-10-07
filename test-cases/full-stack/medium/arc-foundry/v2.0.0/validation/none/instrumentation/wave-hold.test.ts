// instrumentation/wave-hold — the held wave stays running, and everything else
// keeps running with it.
//
// THE REQUIREMENT. `specs/instrumentation.md` gives the surface three holds, each
// on one faculty, and this is the second: "`setWaveHold` holds one faculty of the
// run: the resolution that ends a wave. While the hold is on, a wave whose units
// have all died or leaked stays running — no wave-clear bonus is paid, the wave
// counter does not advance, and no build phase opens — and every other rule keeps
// running exactly as it does with the hold off, so structures fire, bounties are
// paid, leaks cost Grid Integrity, and defeat still resolves at zero Grid
// Integrity."
//
// WHY IT IS ITS OWN POINT. A wave-clear bonus lands in the same counter a bounty
// does, so every check in this project that reads Charge across a kill holds the
// resolution first. A build that pays the bonus anyway, or that stops paying
// bounties while the hold is on, would make each of those report a defect that
// belongs here.
//
// HOW IT IS DECIDED. One unit is killed on a held wave, and three things are read
// against the roster's own bounty: the Charge that arrived is that bounty and not
// a penny more, the wave counter has not advanced, and the wave is still running
// with the yard empty. Then the hold is released, and the wave clears — which is
// what makes the first half a HOLD rather than a build that never clears a wave
// at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { loadDef, structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  type Harness,
} from "../harness";

/** The Capacitor that lands the killing shot. Clear of every platform. */
const GUN = { col: 30, row: 20 };

/** Where the victim is held: `60` units out, inside the Capacitor's `100`. */
const KILL_AT = {
  x: structureCenter(GUN.col, GUN.row).x + 60,
  y: structureCenter(GUN.col, GUN.row).y,
};

/** The type killed, and the wave the run is posed at. */
const TYPE = "mote";
const WAVE = 3;

/** Five seconds: past the slowest cadence staged here. */
const PATIENCE = ticks(5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the clear-and-pay while every other rule keeps running", async () => {
  await openYard(h, { wave: WAVE, charge: 0 });
  await h.debug.setPhase("wave");
  await h.debug.setWaveHold(true);
  assertEqual(
    (await h.snapshot()).waveHeld,
    true,
    "snapshot().waveHeld with the hold engaged (specs/instrumentation.md)",
  );

  await standComponent(h, "capacitor", 1, GUN.col, GUN.row);

  const held = await captureReplay(h, "hold", async () => {
    const id = await parkUnit(h, TYPE, KILL_AT, { hp: 1 });
    const dead = await h.until((s) => !s.units.some((u) => u.id === id), {
      maxFrames: PATIENCE,
    });
    assertEqual(
      dead.hit,
      true,
      `the ${TYPE} held under the Capacitor to be killed by it`,
    );
    // And a good stretch past the kill, which is where an unheld wave clears.
    await h.advance(ticks(1));
    return h.snapshot();
  });

  // The bounty arrived — the economy is still running under the hold.
  assertEqual(
    held.charge,
    loadDef(TYPE).bounty,
    `the Charge a killed ${TYPE} paid under the hold, which is its bounty of ` +
      `${loadDef(TYPE).bounty} and no wave-clear bonus on top of it ` +
      "(specs/instrumentation.md)",
  );
  // And the wave did not end, though its last unit is gone.
  assertEqual(
    held.phase,
    "wave",
    "the phase with the hold on and the yard empty, which stays in the wave " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    held.wave,
    WAVE,
    "the wave counter with the hold on, which does not advance " +
      "(specs/instrumentation.md)",
  );

  // Released, the wave resolves the ordinary way — so what was read above is a
  // hold rather than a build that never clears a wave at all.
  await h.debug.setWaveHold(false);
  const cleared = await h.until((s) => s.phase === "build", {
    maxFrames: PATIENCE,
  });
  assertEqual(
    cleared.hit,
    true,
    "the wave to clear and open a build phase once the hold is released " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    cleared.snapshot.waveHeld,
    false,
    "snapshot().waveHeld once the hold is released",
  );
});
