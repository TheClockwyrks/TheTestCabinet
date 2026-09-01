// Wick — pin/spread: a firing of several darts spreads them vertically by
// `PIN_SPREAD`, centered on the lamplighter.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Pin"): "Amount `n` darts fire on the same tick,
//     spread vertically: dart `i`, counted from `0`, starts at `x = player.x`
//     and `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`, with `PIN_SPREAD`
//     (`10`)." Row 4 of `PIN_LEVELS` gives amount `3`, so the three darts
//     start at `y` offsets `-10`, `0`, and `10`.
//   - `specs/weapons.md` ("Derived stats"): "`PIN_SPREAD` ... [is] unchanged by
//     any passive", and amount is "table value + `amountBonus`", `3` with no
//     Mirror held (`specs/passives.md`).
//   - `specs/world.md` ("One tick"), phase 5: a firing creates its projectiles
//     "at the lamplighter's ... positions of this tick", and phase 6: a new
//     projectile is "first moving on the next tick", so after the firing tick
//     each dart still sits where it started.
//   - `specs/state.md` (`ProjectileState`): "`x`, `y`: the center of its
//     collision circle".
//
// WHAT IS READ. The three darts after the firing tick, ordered by `y`: their
// `x` must each read the lamplighter's `x`, and their `y` offsets from the
// lamplighter's `y` must read `-10`, `0`, and `10`. The darts are ordered by
// `y` rather than by `id`, because the spec fixes where dart `i` starts and
// not which id it takes.
//
// WHY THE NIGHT IS POSED AS IT IS. Pin alone at level 4, the lowest level
// whose amount is `3`, nothing on the field, every switch off but
// `weaponFire`. No key is held, so the lamplighter stands where the run began
// and the offsets are read against a center that did not move; `effectMotion`
// off holds each dart at its launch position for the reading, as phase 6 would
// anyway before its first move.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each coordinate: exact arithmetic on stated
// figures. None on the count, a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  PIN_LEVELS,
  PIN_SPREAD,
  derived,
} from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armPin } from "./dart";

/** The lowest level whose row gives amount 3: level 4. */
const LEVEL = PIN_LEVELS.findIndex((row) => row.amount === 3) + 1;

/** The darts one firing at that level produces: `3 + amountBonus`, 3. */
const AMOUNT = PIN_LEVELS[LEVEL - 1].amount + derived.amountBonus({});

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

it("starts the three level-4 darts at y offsets -10, 0, and 10 from the lamplighter", async () => {
  const { player } = armPin(h, LEVEL);

  const after = await h.tick(1);
  captureStill(h, "spread");

  const darts = projectilesOf(after, "pin").sort((a, b) => a.y - b.y);
  assertLength(darts, AMOUNT, "Pin darts after the firing tick");
  darts.forEach((dart, i) => {
    assertWithin(
      dart.x,
      player.x,
      FIGURE_TOLERANCE,
      `dart ${i} by y: x against the lamplighter's x`,
    );
    assertWithin(
      dart.y - player.y,
      OFFSETS[i],
      FIGURE_TOLERANCE,
      `dart ${i} by y: y offset from the lamplighter`,
    );
  });
});
