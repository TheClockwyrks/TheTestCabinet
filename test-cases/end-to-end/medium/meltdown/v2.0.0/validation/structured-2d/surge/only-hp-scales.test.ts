// Meltdown — surge/only-hp-scales: the wave moves the hp and nothing else.
//
// THE RULE. `specs/waves.md` closes its scaling section with the negative:
// "Nothing else scales with the wave. Speeds, bounties, and leak values are the
// same on the last wave as on the first, and every other system is unchanged
// across a run." So this point is the mirror of
// `surge/hp-scales-with-the-wave` — that one decides what DOES move, and this one
// decides that the same wave number leaves the other three columns of
// `specs/surge.md`'s table exactly where they were.
//
// WHY WAVE 20, AND WHY ON MEDIUM. Containment on Medium runs 20 waves
// (`specs/modes.md`), so wave 20 is the last wave of a real run and the furthest
// from wave 1 that run reaches. `hpScale(20)` is `12.78`, so any build that folded
// the wave scaling into a figure it should not have is reading something close to
// thirteen times the stated one — an error too large to be mistaken for anything
// else. A build that scaled by a smaller factor still shows, because the
// assertions are exact.
//
// THE THREE READINGS, AND WHERE EACH COMES FROM. Speed is a field: a unit reports
// `baseSpeed`, which `specs/instrumentation.md` defines as "its type's speed", so
// it is read off the frame the unit entered with its locomotion held off. Bounty
// and leak are not fields, so each is reached the way the run reaches it —
// `specs/economy.md` pays the bounty "on the frame a unit's hp reaches `0`", and
// `specs/surge.md` charges the leak when a unit "reached its assigned exhaust" —
// and read as a difference across the event. Each scenario opens on its own
// `startRun` at wave 20, so no reading stands on the residue of the one before it.
//
// WHY THE MOTE. It is the baseline row and the one the item names, and its three
// unscaled figures — `60`, `3` and `1` — are all small, so a build that multiplied
// any of them by `12.78` reads a number that is not close to the right one by any
// rounding. What those three figures ARE is `surge/mote-stats`; that the wave left
// them alone is here.
//
// WHY THE BUILD PHASE. A wave clears only while the phase is `wave`
// (`specs/waves.md`), and clearing wave 20 of a 20-wave run ends the run in
// victory and pays for every life left. In a build phase the kill pays the bounty,
// the leak costs the leak, and nothing else pays anything.
//
// WHAT EVERY WRONG MODEL READS. A build that scaled the speed reads `766.8` rather
// than `60`; one that scaled the bounty reads `38` rather than `3`; one that
// scaled the leak reads `13` lives rather than `1`; one that scaled the bounty by
// the wave number reads `60`. None of them is inside an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS, hpScale } from "../../src/constants";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import {
  poseGun,
  poseLeaker,
  poseMark,
  poseStill,
  runUntilGone,
  runUntilLeaked,
  unitOf,
} from "./scenario";

/** The row `specs/surge.md` tabulates for the Mote, as the build was handed it. */
const ROW = SURGE_DEFS.mote;

/** The last wave of a 20-wave Containment run (`specs/modes.md`). */
const DEEP_WAVE = 20;

/**
 * Decimal places the base speed is held to: six, so the allowance is `5e-7`.
 *
 * `specs/waves.md` states the speed is "the same on the last wave as on the
 * first", which is an identity rather than a measurement, so the only allowance
 * needed is for floating-point arithmetic. The smallest wrong model here, a build
 * scaling by `hpScale(20)`, is off by a factor of nearly thirteen.
 */
const EXACT_DIGITS = 6;

/**
 * Decimal places the scaled hp is held to in the precondition: three, so the
 * allowance is `0.0005`.
 *
 * Looser than the identities this point asserts, and deliberately: `40 * 12.78`
 * is a product a build computes rather than a figure it was handed, so the
 * reading carries whatever a build's own arithmetic leaves behind. Three places
 * is far below the `471.2` the product is and far below any neighbouring wave's,
 * which are `446.4` and `496.0`. What the exact figure is belongs to
 * `surge/hp-scales-with-the-wave`; here it only has to have moved.
 */
const HP_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open a build phase on the deep wave, with an empty, quiet floor. */
function deepRun(): void {
  startRun(h, "containment", "medium");
  h.debug.setWave(DEEP_WAVE);
}

it("leaves a wave-20 Mote's speed, bounty and leak at their wave-1 figures", async () => {
  // ---- The speed the unit reports ------------------------------------------
  deepRun();
  const id = poseStill(h, "mote");
  const posed = h.snapshot();
  await h.advance(1);
  captureStill(h, "unscaled");

  const unit = unitOf(posed, id);
  assertEqual(
    posed.wave,
    DEEP_WAVE,
    "precondition: the run is on the wave this point reads",
  );
  // The scaling this point is the negative of, standing as its precondition: if
  // the hp did not move either, there is nothing for the other three columns to
  // have been left out of, and a build that ignores the wave entirely would read
  // three unscaled figures for the wrong reason.
  assertCloseTo(
    unit.maxHp,
    ROW.hp * hpScale(DEEP_WAVE),
    HP_DIGITS,
    `precondition: a wave-${DEEP_WAVE} Mote's maximum hp, which specs/waves.md ` +
      `does move off the base ${ROW.hp}`,
  );
  assertCloseTo(
    unit.baseSpeed,
    ROW.speed,
    EXACT_DIGITS,
    `a wave-${DEEP_WAVE} Mote's base speed, which specs/waves.md leaves at ` +
      `the ${ROW.speed} specs/surge.md states`,
  );
  assertCloseTo(
    unit.speed,
    ROW.speed,
    EXACT_DIGITS,
    `a wave-${DEEP_WAVE} Mote's current speed, carrying no slow, which ` +
      `specs/waves.md leaves at the ${ROW.speed} specs/surge.md states`,
  );

  // ---- What killing one deep into a run pays -------------------------------
  deepRun();
  poseGun(h);
  poseMark(h, "mote");
  const moneyBefore = h.snapshot().money;
  const died = await runUntilGone(h);
  const moneyAfter = h.snapshot().money;

  assertTrue(died, "precondition: the Arc's shot took the Mote to 0 hp");
  assertEqual(
    moneyAfter - moneyBefore,
    ROW.bounty,
    `the money a killed wave-${DEEP_WAVE} Mote paid, which specs/waves.md ` +
      `leaves at the ${ROW.bounty} specs/surge.md states`,
  );

  // ---- What letting one through deep into a run costs ----------------------
  deepRun();
  poseLeaker(h, "mote");
  const livesBefore = h.snapshot().lives;
  const leaked = await runUntilLeaked(h);
  const livesAfter = h.snapshot().lives;

  assertTrue(leaked, "precondition: the Mote reached its exhaust and left");
  assertEqual(
    livesBefore - livesAfter,
    ROW.leak,
    `the lives a leaked wave-${DEEP_WAVE} Mote cost, which specs/waves.md ` +
      `leaves at the ${ROW.leak} specs/surge.md states`,
  );
});
