// Meltdown — heat/redline-multiplier: at the redline a shot deals 3.5 * baseDamage.
//
// `specs/heat.md` gives `heatMultiplier(H, R) = 0.35 + 3.15 * (min(H, R) / R)^2`,
// so at `H = R` the squared term is `1` and the multiplier is `MAX_HEAT_MULT`
// exactly. `specs/combat.md` makes one shot remove
// `baseDamage(level) * heatMultiplier(H, redline)`, so a level-I Arc at its
// redline of `80` removes `6 * 3.5`, which is `21` hp.
//
// The heat is posed AT the redline rather than above it, because this item is
// about where full power arrives; that it goes no higher above the redline is
// `heat/plateau-holds`. The Arc is pinned, so the shot resolves at exactly the
// heat posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { MAX_HEAT_MULT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { oneShotDamage } from "./one-shot";
import { emitterDefOf, figuresOf } from "./roster";

/** The emitter read, and the two figures `specs/towers.md` gives it. */
const TOWER = "arc";
const REDLINE = emitterDefOf(TOWER).redline;
const BASE_DAMAGE = figuresOf(TOWER).baseDamage;

/** What the two specs together require at the redline: 6 * 3.5. */
const EXPECTED = BASE_DAMAGE * MAX_HEAT_MULT;

/**
 * How close the removal must come, as decimal places of a hit point.
 *
 * Three places is `0.0005` hp. The reading is one subtraction of two hp values a
 * build computed from exact products, so nothing about a conformant build needs
 * room here; what the figure excludes is every wrong multiplier, the nearest of
 * which — the `1.1375` a linear ramp would have reached at half the redline, or
 * the `0.35` of a curve that never climbed — is many hit points away.
 */
const DAMAGE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Full power arrives at the redline", async () => {
  const removed = await oneShotDamage(h, TOWER, REDLINE);
  await captureStill(h, "redline");

  assertCloseTo(
    removed,
    EXPECTED,
    DAMAGE_DIGITS,
    `hp one level-I ${TOWER} shot removes at its redline of ${REDLINE}`,
  );
});
