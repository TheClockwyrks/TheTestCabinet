// Meltdown — heat/curve-is-quadratic: the climb to the redline is quadratic.
//
// `specs/heat.md` gives `heatMultiplier(H, R) = 0.35 + 3.15 * (min(H, R) / R)^2`
// and states the value at half the redline outright: `0.35 + 3.15 * 0.25`, which
// is `1.1375`. A LINEAR ramp between the same two ends would read `1.925` there,
// so half the redline is the heat at which the two models are furthest apart in
// proportion and a build that ramped straight from `0.35` to `3.5` reads a
// number nothing else could produce.
//
// `specs/combat.md` makes one shot remove
// `baseDamage(level) * heatMultiplier(H, redline)`, so a level-I Arc (base
// damage `6`, redline `80`) posed at heat `40` removes `6 * 1.1375` — `6.825` hp
// — against the `11.55` a linear ramp would remove.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { heatMultiplier } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { oneShotDamage } from "./one-shot";
import { emitterDefOf, figuresOf } from "./roster";

/** The emitter read, and the two figures `specs/towers.md` gives it. */
const TOWER = "arc";
const REDLINE = emitterDefOf(TOWER).redline;
const BASE_DAMAGE = figuresOf(TOWER).baseDamage;

/** Half the redline: where the quadratic and a linear ramp differ most. */
const HALF_REDLINE = REDLINE / 2;

/** `6 * (0.35 + 3.15 * 0.25)`, which is 6.825 hp. */
const EXPECTED = BASE_DAMAGE * heatMultiplier(HALF_REDLINE, REDLINE);

/**
 * How close the removal must come, as decimal places of a hit point.
 *
 * Three places is `0.0005` hp. The reading is one subtraction of hp values a
 * build computed from exact products, and the wrong model this check exists to
 * name — a linear ramp, at `11.55` hp — is `4.7` hp away, nearly ten thousand
 * times the bound.
 */
const DAMAGE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The climb is quadratic", async () => {
  const removed = await oneShotDamage(h, TOWER, HALF_REDLINE);
  await captureStill(h, "halfway");

  assertCloseTo(
    removed,
    EXPECTED,
    DAMAGE_DIGITS,
    `hp one level-I ${TOWER} shot removes at heat ${HALF_REDLINE}, half its ` +
      `redline of ${REDLINE}`,
  );
});
