// Meltdown — heat/plateau-holds: above the redline the multiplier holds flat.
//
// specs/heat.md clamps the curve's input at the redline —
// `heatMultiplier(H, R) = 0.35 + 3.15 * (min(H, R) / R)^2` — and says so in
// words: "at heat `R` and anywhere above it the multiplier is `MAX_HEAT_MULT`",
// and "heat carried past the redline buys no damage". So the band from `R` to
// `100` is a plateau, and a shot fired anywhere in it removes
// `baseDamage(level) * 3.5`.
//
// TWO HEATS INSIDE THE BAND, because the requirement is that the band is FLAT and
// one reading cannot show a slope. Both are read on a level-I Arc, whose redline
// is `80`, and each shot must remove `21` hp:
//
//   - heat 90, ten points in;
//   - heat 99, the last point below the trip, where an unclamped quadratic would
//     read `0.35 + 3.15 * (99 / 80)^2` and remove `31.0` hp instead.
//
// The redline itself is not read here: that full power ARRIVES at the redline is
// `heat/redline-multiplier`'s single requirement.
//
// EACH SCENARIO IS POSED FROM SCRATCH by `oneShotDamage`, which opens with
// `startRun` and so empties the tower roster: the second reading is taken on a
// new emitter whose fire clock opens at zero rather than on the residue of the
// first.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_HEAT_MULT } from "../constants";
import { assertCloseTo } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { oneShotDamage } from "./one-shot";
import { figuresOf, redlineOf } from "./roster";

/** The emitter read, and the two figures specs/towers.md gives it. */
const TOWER = "arc";
const REDLINE = redlineOf(TOWER);
const BASE_DAMAGE = figuresOf(TOWER).baseDamage;

/** Two heats inside the plateau: just inside it, and the last point below 100. */
const PLATEAU_HEATS: readonly number[] = [REDLINE + 10, 99];

/** What every shot in the band must remove: 6 * 3.5, which is 21 hp. */
const EXPECTED = BASE_DAMAGE * MAX_HEAT_MULT;

/**
 * How close each removal must come, as decimal places of a hit point.
 *
 * Three places is `0.0005` hp. The reading is one subtraction of hp values a
 * build computed from exact products, and the wrong model this check exists to
 * name — a curve that goes on climbing past the redline, at `31.0` hp at heat
 * 99 — is `10` hp away.
 */
const DAMAGE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The plateau holds to the trip", async () => {
  for (const heat of PLATEAU_HEATS) {
    const removed = await oneShotDamage(h, TOWER, heat);
    captureStill(h, "plateau");

    assertCloseTo(
      removed,
      EXPECTED,
      DAMAGE_DIGITS,
      `hp one level-I ${TOWER} shot removes at heat ${heat}, above its ` +
        `redline of ${REDLINE}`,
    );
  }
});
