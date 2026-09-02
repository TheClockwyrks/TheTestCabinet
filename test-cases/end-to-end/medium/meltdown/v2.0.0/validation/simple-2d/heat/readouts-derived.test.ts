// Meltdown — heat/readouts-derived: the reported multiplier and damage follow the heat.
//
// A snapshot reports `heatMult` and `damage` per tower
// (specs/instrumentation.md), and neither is a free number: specs/heat.md fixes
// the multiplier as `heatMultiplier(H, R)` and specs/combat.md fixes per-shot
// damage as `baseDamage(level) * heatMultiplier(H, redline)`. So both readouts
// are derived, and what this item decides is that they are derived LIVE from the
// heat the tower is carrying rather than latched at some earlier moment or
// computed off a different curve.
//
// FIVE HEATS, chosen to pin the whole shape of the curve on one tower: the cold
// end, two points on the quadratic climb, the redline itself, and one inside the
// plateau. A level-I Arc carries the reading, so its redline is `80` and its base
// damage `6`.
//
// THE EXPECTATION IS THE CASE'S OWN CURVE. `thermal.ts` restates
// specs/heat.md's formula over the two scalar constants `constants.ts` states;
// the build has a `heatMultiplier` of its own in `src/constants.ts` and this
// check never calls it, because a readout compared against the build's own
// curve would agree with a build that changed the curve.
//
// NEITHER FACULTY RUNS. The tower is posed with its thermal model off, so the
// heat cannot drift between the pose and the read, and with its guns off, so
// nothing is fired: this item is about a readout, not about a shot. Each heat is
// followed by one frame, so a build that recomputes its readouts inside its
// update is read after that update rather than before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { heatMultiplierOf } from "../thermal";
import { figuresOf, redlineOf } from "./roster";
import { FREE_SITE } from "./sites";

/** The emitter read, and the two figures specs/towers.md gives it. */
const TOWER = "arc";
const REDLINE = redlineOf(TOWER);
const BASE_DAMAGE = figuresOf(TOWER).baseDamage;

/** The five heats: the cold end, two on the climb, the redline, and the plateau. */
const HEATS: readonly number[] = [0, 20, 40, REDLINE, 99];

/**
 * How close each readout must come, as decimal places.
 *
 * Four places on the multiplier is `0.00005`, and three on the damage is `0.0005`
 * hp. Both readouts are a build's own evaluation of a closed-form expression over
 * figures the specification states exactly, so a conformant build needs no room
 * at all; the bounds are set to exclude every other curve the multiplier could
 * have been given, the nearest of which differs by hundredths at the very least.
 */
const MULT_DIGITS = 4;
const DAMAGE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The reported multiplier and damage follow the heat", async () => {
  startRun(h);
  const id = posePinnedTower(h, TOWER, FREE_SITE.col, FREE_SITE.row, 0);
  h.debug.setTowerFiring(id, false);

  for (const heat of HEATS) {
    h.debug.setTowerHeat(id, heat);
    await h.advance(1);
    const read = towerOf(h.snapshot(), id);
    captureStill(h, "readouts");

    const expectedMult = heatMultiplierOf(heat, REDLINE);
    assertCloseTo(
      read.heatMult,
      expectedMult,
      MULT_DIGITS,
      `heatMult at heat ${heat} with a redline of ${REDLINE}`,
    );
    assertCloseTo(
      read.damage,
      BASE_DAMAGE * expectedMult,
      DAMAGE_DIGITS,
      `damage at heat ${heat}: baseDamage ${BASE_DAMAGE} * the multiplier`,
    );
  }
});
