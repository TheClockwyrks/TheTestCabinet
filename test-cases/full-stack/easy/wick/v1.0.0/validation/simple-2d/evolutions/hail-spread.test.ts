// Wick — evolutions/hail-spread: Hail's darts are spread vertically by
// `PIN_SPREAD` and fly in the facing direction.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Hail"): "a circle of `radius` fired horizontally
//     in the facing direction at `speed` ... Amount `n` darts fire on the same
//     tick, dart `i` counted from `0` starting at `x = player.x` and
//     `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`, with `PIN_SPREAD`
//     (`10`)." The fixed row has amount `6` and speed `700`, so the six offsets
//     are −25, −15, −5, 5, 15, and 25.
//   - `specs/weapons.md` ("The nearest enemy"): the facing direction is "`+x`
//     for `"right"`", so a dart's velocity while facing right is `(700, 0)`.
//   - `specs/weapons.md` ("Derived stats"): "`OIL_SCATTER`, `SPARK_RANGE`,
//     `PIN_SPREAD`, the spread angles, and the re-hit intervals are unchanged
//     by any passive", and no passive is held in any case.
//   - `specs/world.md` ("One tick"), phase 5: a firing creates its projectiles
//     "at the lamplighter's ... positions of this tick", and phase 6: a new
//     projectile is "first moving on the next tick", so after the firing tick
//     each dart still sits where it started.
//
// WHAT IS READ. The six darts after the firing tick, ordered by `y`: each
// dart's `x` reads the lamplighter's `x`, its `y` offset from the lamplighter
// reads −25, −15, −5, 5, 15, 25 in that order, and its velocity reads
// `(700, 0)`. The darts are ordered by `y` rather than by `id`, because the
// specification fixes where dart `i` starts and not which id it takes.
//
// WHY THE NIGHT IS POSED AS IT IS. Hail alone facing right, no passive held so
// the amount is the fixed `6`, nothing on the field, every driver switch but
// `weaponFire` off. No key is held, so the lamplighter stands where the run
// began and the offsets are read against a center that did not move;
// `effectMotion` off holds each dart at its launch position for the reading.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each coordinate and each velocity component:
// exact arithmetic on stated figures. None on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, HAIL_STATS, PIN_SPREAD } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";

/** The darts one firing produces: the fixed amount plus `amountBonus`, 0. */
const AMOUNT = HAIL_STATS.amount;

/** The `y` offsets dart `i` starts at: `(i − (n − 1) / 2) × PIN_SPREAD`. */
const OFFSETS = Array.from(
  { length: AMOUNT },
  (_, i) => (i - (AMOUNT - 1) / 2) * PIN_SPREAD,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts the six darts at y offsets -25 to 25 and sends each along +x at 700", async () => {
  const { player } = armEvolved(h, "hail", { facing: "right" });

  const after = await h.tick(1);
  captureStill(h, "spread");

  const darts = projectilesOf(after, "hail").sort((a, b) => a.y - b.y);
  assertLength(darts, AMOUNT, "Hail darts after the firing tick");
  darts.forEach((dart, i) => {
    const which = `dart ${i} by y`;
    assertWithin(
      dart.x,
      player.x,
      FIGURE_TOLERANCE,
      `${which}: x against the lamplighter's x`,
    );
    assertWithin(
      dart.y - player.y,
      OFFSETS[i],
      FIGURE_TOLERANCE,
      `${which}: y offset from the lamplighter`,
    );
    assertWithin(dart.vx, HAIL_STATS.speed, FIGURE_TOLERANCE, `${which}: vx`);
    assertWithin(dart.vy, 0, FIGURE_TOLERANCE, `${which}: vy`);
  });
});
