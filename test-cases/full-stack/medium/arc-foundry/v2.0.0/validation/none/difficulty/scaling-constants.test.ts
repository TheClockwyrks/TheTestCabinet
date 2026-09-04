// difficulty/scaling-constants — each difficulty scales health by its own four
// constants.
//
// THE REQUIREMENT. `specs/enemies.md` fixes a unit's maximum health on wave `w`
// as `round(baseHP * baseMult * [(1 + k(w - 1)) + c(r^(w-1) - 1)])`, rounded to
// the nearest whole number, and `specs/difficulty.md` gives the four constants
// per difficulty: `0.20, 0.50, 0.08, 1.09` on Easy, `0.22, 1.17, 0.28, 1.145` on
// Medium and `0.24, 1.30, 0.22, 1.15` on Hard. The constants are the only thing
// difficulty changes about a unit, so the same type at the same wave carries a
// different maximum health at each of the three.
//
// HOW IT IS DECIDED. A run is opened at each difficulty on an EMPTY yard at one
// fixed wave, and one unit of every roster type is released and held, so nothing
// on the yard can shoot it and its own travel cannot carry it into the collector
// before its health is read. `maxHp` is then held against the formula evaluated
// with that difficulty's constants and that type's base health — an exact whole
// number, because the specification rounds the product to one. The same figure is
// then held APART across the three difficulties, so a build that computes one
// difficulty's curve and serves it for all three fails.
//
// WHY WAVE 20. Late enough that the exponential surcharge separates the three
// curves by a wide margin (a Mote reads 95, 258 and 302), and inside every
// difficulty's run, since the shortest is 40 waves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { DIFFICULTIES, LOAD_ROSTER, scaledHp } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  releaseUnit,
  unitById,
  type Harness,
} from "../harness";

/** The wave every unit below is released at. */
const WAVE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scales maximum health by the constants of the chosen difficulty", async () => {
  /** The maximum health each roster type read, per difficulty. */
  const read = new Map<string, number[]>();

  for (const difficulty of DIFFICULTIES) {
    await openYard(h, { difficulty: difficulty.id, wave: WAVE });

    for (const unit of LOAD_ROSTER) {
      // Travel held and nothing else: the health this reads has to be the health
      // the spawner gave it, so the unit must not have walked, leaked, or been
      // shot at between the release and the read.
      const id = await releaseUnit(h, unit.type, { frozen: true });
      const released = unitById(await h.snapshot(), id);

      assertEqual(
        released.maxHp,
        scaledHp(unit.baseHp, WAVE, difficulty),
        `a ${unit.type}'s maximum health on wave ${WAVE} at ${difficulty.id}, ` +
          `from base health ${unit.baseHp} through the scaling of ` +
          "specs/enemies.md with the constants of specs/difficulty.md",
      );
      // A released unit arrives at full health for the current wave.
      assertEqual(
        released.hp,
        released.maxHp,
        `a freshly released ${unit.type}'s health (specs/instrumentation.md)`,
      );

      const seen = read.get(unit.type) ?? [];
      seen.push(released.maxHp);
      read.set(unit.type, seen);
    }
  }

  await captureStill(h, "scaling");

  // The three curves are three different curves. Every type separates them,
  // because `baseMult`, `k`, `c` and `r` all differ between the difficulties.
  for (const unit of LOAD_ROSTER) {
    const [easy, medium, hard] = read.get(unit.type) as [
      number,
      number,
      number,
    ];
    assertNotEqual(
      easy,
      medium,
      `a ${unit.type} on wave ${WAVE} to differ between Easy and Medium ` +
        "(specs/difficulty.md)",
    );
    assertNotEqual(
      medium,
      hard,
      `a ${unit.type} on wave ${WAVE} to differ between Medium and Hard ` +
        "(specs/difficulty.md)",
    );
  }
});
