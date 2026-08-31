// Meltdown — heat/cold-multiplier: at heat 0 a shot deals 0.35 * baseDamage.
//
// specs/heat.md gives the damage multiplier as
// `heatMultiplier(H, R) = 0.35 + 3.15 * (min(H, R) / R)^2`, so at heat `0` it is
// `MIN_HEAT_MULT` exactly, and specs/combat.md makes one shot remove
// `baseDamage(level) * heatMultiplier(H, redline)` with no exception. A level-I
// Arc (`baseDamage` 6) therefore removes `6 * 0.35`, which is `2.1` hp.
//
// The Arc is pinned with `posePinnedTower`, so the shot resolves at exactly the
// heat posed rather than at whatever heat a running thermal model had drifted to
// by the time the fire clock came round.

import { afterEach, beforeEach, it } from "vitest";
import { MIN_HEAT_MULT } from "../../src/constants";
import { assertCloseTo } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { oneShotDamage } from "./one-shot";
import { figuresOf } from "./roster";

/** The cold end of the scale. */
const COLD_HEAT = 0;

/** The emitter read, and its level-I base damage from specs/towers.md. */
const TOWER = "arc";
const BASE_DAMAGE = figuresOf(TOWER).baseDamage;

/** What specs/heat.md and specs/combat.md together require: 6 * 0.35. */
const EXPECTED = BASE_DAMAGE * MIN_HEAT_MULT;

/**
 * How close the removal must come, as decimal places of a hit point.
 *
 * Three places is a tolerance of `0.0005` hp. The reading is one subtraction of
 * two hp values a build computed from exact products, so float slack is many
 * orders below that; what the figure has to leave room for is nothing, and what
 * it has to exclude is every other multiplier the curve could have been given —
 * the nearest of them, an unscaled shot at `1.0`, is `3.9` hp away.
 */
const DAMAGE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A stone-cold gun is feeble", async () => {
  const removed = await oneShotDamage(h, TOWER, COLD_HEAT);
  captureStill(h, "cold");

  assertCloseTo(
    removed,
    EXPECTED,
    DAMAGE_DIGITS,
    `hp one level-I ${TOWER} shot removes at heat ${COLD_HEAT}`,
  );
});
