// pin/spread — the darts of one firing spread vertically by PIN_SPREAD.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"): "Amount `n`
// darts fire on the same tick, spread vertically: dart `i`, counted from `0`,
// starts at `x = player.x` and `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`,
// with `PIN_SPREAD` (`10`)." Level 4's row gives amount 3, and with no
// Mirror held `amountBonus` is 0 (`specs/passives.md`), so `n` is 3 and the
// three darts start at `x = player.x` with `y` offsets `(0 − 1) × 10`,
// `(1 − 1) × 10`, and `(2 − 1) × 10`: −10, 0, and 10. ("Derived stats"):
// "`PIN_SPREAD` ... [is] unchanged by any passive."
//
// WHY THE STARTS ARE READ ON THE FIRING TICK. `specs/world.md` ("One tick"),
// phase 5 creates a firing's projectiles "at the lamplighter's ... positions
// of this tick", and phase 6 has a new projectile "first moving on the next
// tick", so the snapshot after the firing tick holds each dart at its start.
// The lamplighter holds no key, so `player` is where the run began.
//
// WHAT IS COMPARED. The specification numbers the darts but fixes no order
// for the ids a tick hands out, so the three offsets are compared as a sorted
// set against the sorted `[−10, 0, 10]`: any build that placed the three where
// the formula says passes, whichever dart it created first.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, Pin at level 4 armed, `weaponFire` on and every other switch off.
// That level 4 creates exactly three darts is `row-4`'s point; here the count
// is the precondition the offsets are read under.
//
// THE TOLERANCE. `REAL_EPS` on each coordinate: a copy of the player's center
// plus a product of two small integers. Darts left unspread sit 10 apart from
// where two of them belong, and a spread of the wrong step is off by units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { PIN_LEVELS, PIN_SPREAD, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { firePin } from "./firing";

/** Level 4 of Pin: amount 3. */
const LEVEL = 4;
const ROW = PIN_LEVELS[LEVEL - 1];

/** `(i − (n − 1) / 2) × PIN_SPREAD` for `i` in `0 .. n − 1`, ascending. */
const OFFSETS: readonly number[] = Array.from(
  { length: ROW.amount },
  (_, i) => (i - (ROW.amount - 1) / 2) * PIN_SPREAD,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts the three level-4 darts at x = player.x and y offsets −10, 0, and 10", async () => {
  if (ROW.amount !== 3) {
    throw new Error("the posed level must carry amount 3");
  }
  const firing = await firePin(h, LEVEL);
  captureStill(h, "spread");

  const { player } = firing.after.run;
  assertEqual(
    firing.darts.length,
    ROW.amount,
    `the darts the firing tick created at level ${LEVEL} (specs/weapons.md, Pin)`,
  );
  for (const dart of firing.darts) {
    assertNear(
      dart.x,
      player.x,
      REAL_EPS,
      `dart ${dart.id}'s x, against player.x (specs/weapons.md, Pin)`,
    );
  }

  // The offsets as a sorted set, so the comparison holds whichever dart the
  // build created first.
  const offsets = firing.darts
    .map((dart) => dart.y - player.y)
    .sort((a, b) => a - b);
  for (let i = 0; i < offsets.length; i += 1) {
    assertNear(
      offsets[i],
      OFFSETS[i],
      REAL_EPS,
      `y offset ${i} of the sorted darts, against (i − 1) × PIN_SPREAD (specs/weapons.md, Pin)`,
    );
  }
});
