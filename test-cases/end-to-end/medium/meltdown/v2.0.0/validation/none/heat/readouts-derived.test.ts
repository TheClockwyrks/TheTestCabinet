// Meltdown — heat/readouts-derived: the reported multiplier and damage follow the heat.
//
// A snapshot reports `heatMult` and `damage` per tower
// (`specs/instrumentation.md`), and neither is a free number: `specs/heat.md`
// fixes the multiplier as `heatMultiplier(H, R)` and `specs/combat.md` fixes
// per-shot damage as `baseDamage(level) * heatMultiplier(H, redline)`. So both
// readouts are derived, and what this item decides is that they are derived
// LIVE from the heat the tower is carrying rather than latched at some earlier
// moment or computed off a different curve.
//
// FIVE HEATS, chosen to pin the whole shape of the curve on one tower: the cold
// end, two points on the quadratic climb, the redline itself, and one inside the
// plateau. A level-I Arc carries the reading, so its redline is `80` and its
// base damage `6`.
//
// NEITHER FACULTY RUNS. The tower is posed with its thermal model off, so the
// heat cannot drift between the pose and the read, and with its guns off, so
// nothing is fired: this item is about a readout, not about a shot. Each heat is
// followed by one frame, so a build that recomputes its readouts inside its
// update is read after that update rather than before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { heatMultiplier } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { emitterDefOf, figuresOf } from "./roster";

/** The emitter read, and the two figures `specs/towers.md` gives it. */
const TOWER = "arc";
const REDLINE = emitterDefOf(TOWER).redline;
const BASE_DAMAGE = figuresOf(TOWER).baseDamage;

/**
 * The five heats: the cold end, two on the climb, the redline, and the plateau.
 */
const HEATS: readonly number[] = [0, 20, 40, REDLINE, 99];

/**
 * How close each readout must come, as decimal places.
 *
 * Four places on the multiplier is `0.00005`, and three on the damage is
 * `0.0005` hp. Both readouts are a build's own evaluation of a closed-form
 * expression over figures the specification states exactly, so a conformant
 * build needs no room at all; the bounds are set to exclude every other curve
 * the multiplier could have been given, the nearest of which differs by
 * hundredths at the very least.
 */
const MULT_DIGITS = 4;
const DAMAGE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The reported multiplier and damage follow the heat", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, TOWER, FREE_SITE.col, FREE_SITE.row, 0);
  await h.debug.setTowerFiring(id, false);

  for (const heat of HEATS) {
    await h.debug.setTowerHeat(id, heat);
    await h.advance(1);
    const read = requireTower(await h.snapshot(), id, `the ${TOWER} at ${heat}`);
    await captureStill(h, "readouts");

    const expectedMult = heatMultiplier(heat, REDLINE);
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
