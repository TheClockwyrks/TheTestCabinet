// surge/hp-scales-with-the-wave — a unit released on wave `w` carries `hpScale(w)`
// times its base hp.
//
// THE RULE. specs/waves.md, Per-wave scaling: "A unit released on wave `w` carries
// `hpScale(w)` times its base hp", where `hpScale(w) = 1 + 0.62 * (w - 1)`.
// specs/surge.md fixes the base: "HP is the type's base hp before the per-wave
// scaling", and "A unit's maximum hp is its base hp scaled for the wave it belongs
// to". specs/instrumentation.md says the same of a unit posed through the surface:
// `addUnit`'s "`maxHp` is its base hp scaled for the current wave".
//
// THREE WAVES, BECAUSE TWO POINTS FIT TOO MANY CURVES. Wave 1 is the anchor —
// `hpScale(1)` is exactly `1`, so it reads the base figure back unscaled — and
// waves 10 and 20 are far enough out that the multiplier is `6.58` and `12.78`. A
// build that scaled by the wave number itself reads `10` and `20` times the base
// where the rule says `6.58` and `12.78`; one that scaled geometrically reads a
// figure that is not linear in the wave at all; one that ignores the wave reads the
// base three times over.
//
// TWO TYPES, BECAUSE A ONE-TYPE READING CANNOT TELL A SCALE FROM AN ADDITION.
// `hpScale` MULTIPLIES, so a build that added a fixed number of hp per wave can be
// fitted exactly to any single type's three readings — `40, 263.2, 511.2` is
// `40 + 24.8 * (w - 1)` for the Mote — and only a second type with a different base
// separates the two models. The Mote's `40` and the Hulk's `220` are five and a
// half times apart, so the additive model that fits one is nowhere near the other.
//
// THE WAVE IS POSED AND THE UNIT IS ADDED, WHICH IS THE WHOLE SCENARIO.
// `setWave(n)` "rebuilds nothing, releases nothing, and clears nothing"
// (specs/instrumentation.md), so the floor stays as it was and the only thing the
// pose can reach is the scaling the next arrival is given. NOTHING IS DRIVEN before
// the reading: the maximum hp is fixed at the moment of entry, and a frame of
// walking would only give the floor a chance to move a quantity that is already
// settled.
//
// WHY WAVES 10 AND 20 ARE SAFE TO POSE HERE. In the 20-wave Containment run
// `startRun` opens, those two are the milestone waves specs/waves.md makes Core
// waves. That decides what the RUN would release; it decides nothing about a unit
// the surface adds, which takes its type as an argument. So the type read here is
// the type asked for, and the wave number is doing nothing but scaling.
//
// The units are then spread across a row and held still for the evidence frame, so
// the picture carries six health bars side by side rather than six units stacked on
// one vent tile. The reading each assertion uses was taken at the moment of entry,
// before any of that.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS, hpScale } from "../../src/constants";
import { assertCloseTo } from "../assert";
import { tileCentre } from "../geometry";
import {
  captureStill,
  createHarness,
  lastUnit,
  startRun,
  type Harness,
  type SurgeType,
} from "../harness";

/** The waves the scaling is read at: the anchor, the middle, and the last. */
const WAVES = [1, 10, 20] as const;

/** The two bases, far enough apart that no addition fits both. */
const TYPES: readonly SurgeType[] = ["mote", "hulk"];

/**
 * The decimal places a scaled hp is compared to: four.
 *
 * `baseHp * (1 + 0.62 * (w - 1))` is a product of exactly representable decimals
 * evaluated in binary floating point, so a build computing it in any sensible
 * order lands within a few parts in `10^-13` of the figure. Four places is a
 * tolerance of `5e-5`, many orders above that and many orders below the smallest
 * gap this point has to resolve — the `40` between a Mote's wave-1 and the nearest
 * other reading — so it separates every wrong model without failing arithmetic.
 */
const HP_DIGITS = 4;

/** The row the evidence frame lays the arrivals out along, and its first column. */
const SHOWCASE_ROW = 8;
const SHOWCASE_COL0 = 8;
const SHOWCASE_STRIDE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives a wave-w arrival maxHp of its base times 1 + 0.62 * (w - 1)", async () => {
  startRun(h);

  const read: { type: SurgeType; wave: number; maxHp: number; id: number }[] =
    [];
  for (const wave of WAVES) {
    h.debug.setWave(wave);
    for (const type of TYPES) {
      h.debug.addUnit(type, "left");
      const arrived = lastUnit(h.snapshot());
      read.push({ type, wave, maxHp: arrived.maxHp, id: arrived.id });
    }
  }

  // For the picture alone: spread them out and hold them where they stand.
  for (const [index, entry] of read.entries()) {
    const at = tileCentre(
      SHOWCASE_COL0 + index * SHOWCASE_STRIDE,
      SHOWCASE_ROW,
    );
    h.debug.setUnitPosition(entry.id, at.x, at.y);
    h.debug.setUnitMotion(entry.id, false);
  }
  await h.advance(1);
  captureStill(h, "scaled");

  for (const entry of read) {
    assertCloseTo(
      entry.maxHp,
      SURGE_DEFS[entry.type].hp * hpScale(entry.wave),
      HP_DIGITS,
      `${entry.type} added on wave ${entry.wave}: its maximum hp, against its ` +
        `base ${SURGE_DEFS[entry.type].hp} scaled by ${hpScale(entry.wave)}`,
    );
  }
});
