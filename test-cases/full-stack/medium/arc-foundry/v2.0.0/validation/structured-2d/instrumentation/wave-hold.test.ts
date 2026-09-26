// instrumentation/wave-hold — `setWaveHold` holds the wave's clear-and-pay
// resolution, and holds nothing else.
//
// THIS IS THE HOLD EVERY ECONOMY-FACING CHECK IN THIS PROJECT STANDS ON. A wave
// clears when every unit it released has died or leaked, and clearing pays the
// wave-clear bonus into the same counter a bounty is paid into. A check reading
// what one kill paid therefore has to be able to hold that resolution off, and
// `specs/instrumentation.md` gives it the operation to do it: "a wave whose units
// have all died or leaked stays running — no wave-clear bonus is paid, the wave
// counter does not advance, and no build phase opens".
//
// THE HOLD IS NARROW, AND THAT IS THE OTHER HALF. "Every other rule keeps running
// exactly as it does with the hold off, so structures fire, bounties are paid,
// leaks cost Grid Integrity". A build that froze the whole run instead would make
// every one of those checks read a bounty of `0`. So the same span is read for
// both: the bonus must NOT arrive, and the bounty MUST.
//
// AND THE HOLD RELEASES. `setWaveHold(false)` puts the resolution back, so the
// wave that had nothing left on it clears on the next advance and pays.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { LOAD_ROSTER, structureCenter, waveBonus } from "../constants";
import {
  captureReplay,
  createHarness,
  enterPhase,
  type Harness,
  holdWaveClear,
  openYard,
  parkUnit,
  standComponent,
} from "../harness";

/** The wave the run is posed at, and the bonus clearing it pays. */
const WAVE = 4;
const BONUS = waveBonus(WAVE);

/** The Capacitor that lands the killing shot, clear of every platform. */
const GUN = { col: 30, row: 20 };
const GUN_CENTER = structureCenter(GUN.col, GUN.row);
/** `60` units out, inside a Scrap Capacitor's `100` reach. */
const KILL_AT = { x: GUN_CENTER.x + 60, y: GUN_CENTER.y };

/** A Mote's bounty, which is what the kill below has to pay. */
const MOTE = LOAD_ROSTER.find((def) => def.type === "mote")!;

/** Long enough for a wave with nothing on it to have cleared several times over. */
const WATCH_SECONDS = 3;

/**
 * The rate the whole check is driven at.
 *
 * The frames are a kill and then an empty yard being sat out, and
 * specs/instrumentation.md guarantees that "an interval of simulation time
 * reaches the same state however it was divided into frames". A shot still steps
 * well inside the `2 * PROJECTILE_HIT_R` window it has to be caught in.
 */
const WATCH_HZ = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: WATCH_HZ });
});

afterEach(() => {
  h?.dispose();
});

it("holds the wave from clearing while every other rule keeps running", async () => {
  openYard(h, { wave: WAVE, charge: 0 });
  enterPhase(h, "wave");
  holdWaveClear(h);
  standComponent(h, "capacitor", 1, GUN.col, GUN.row);

  const driven = await captureReplay(h, "hold", async () => {
    const opened = h.snapshot();

    // One Mote, held where the Capacitor can reach it, on one point of health.
    // Killing it empties the yard, which is exactly when a wave would clear.
    const id = parkUnit(h, "mote", KILL_AT, { hp: 1 });
    const killed = await h.until(
      (s) => !s.units.some((unit) => unit.id === id),
      { maxFrames: h.ticks(5) },
    );
    await h.advanceSeconds(WATCH_SECONDS);
    const held = h.snapshot();

    // Then the hold comes off, and the wave resolves the ordinary way.
    holdWaveClear(h, false);
    const cleared = await h.until((s) => !s.waveActive, {
      maxFrames: h.ticks(5),
    });
    return { killed, held, cleared, opened };
  });

  assertEqual(
    driven.opened.waveHeld,
    true,
    "snapshot().waveHeld once setWaveHold(true) has been called",
  );
  assertEqual(
    driven.killed.hit,
    true,
    "the Mote held under the Capacitor to be killed by it within five seconds",
  );

  // The bounty arrived: the hold is on the resolution and not on the economy.
  assertEqual(
    driven.held.charge,
    MOTE.bounty,
    `the Charge after the kill, which is the Mote's bounty of ${MOTE.bounty} ` +
      `and NOT that plus the wave-clear bonus of ${BONUS} ` +
      "(specs/instrumentation.md, specs/economy.md)",
  );

  // And the wave did not clear, however long the yard stayed empty.
  assertLength(
    driven.held.units,
    0,
    `the units on the yard ${WATCH_SECONDS}s after the only one died`,
  );
  assertEqual(
    driven.held.waveActive,
    true,
    `whether the wave is still running ${WATCH_SECONDS}s after the last unit ` +
      "of it died, with its clear-and-pay resolution held",
  );
  assertEqual(
    driven.held.phase,
    "wave",
    "the phase a held wave leaves the run in",
  );
  assertEqual(
    driven.held.wave,
    WAVE,
    "the wave counter, which a held wave never advances",
  );

  // Releasing the hold resolves it, and the bonus lands then.
  assertEqual(
    driven.cleared.hit,
    true,
    "the wave clearing once the hold is released",
  );
  assertEqual(
    driven.cleared.snapshot.waveHeld,
    false,
    "snapshot().waveHeld once setWaveHold(false) has been called",
  );
  assertEqual(
    driven.cleared.snapshot.charge,
    MOTE.bounty + BONUS,
    `the Charge once the released wave cleared: the bounty plus the ` +
      `wave-clear bonus of ${BONUS} (specs/economy.md)`,
  );
  assertEqual(
    driven.cleared.snapshot.phase,
    "build",
    "the phase a cleared wave opens",
  );
});
