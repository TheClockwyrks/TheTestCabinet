// evolutions/hail-spread — Hail's darts spread by PIN_SPREAD in the facing
// direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Hail"): "Amount `n`
// darts fire on the same tick, dart `i` counted from `0` starting at
// `x = player.x` and `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`, with
// `PIN_SPREAD` (`10`)", and the dart is "fired horizontally in the facing
// direction at `speed`". `HAIL_STATS` gives amount 6 and speed 700, and with
// no Mirror held `amountBonus` is 0 (`specs/passives.md`), so `n` is 6 and the
// six offsets are `(i − 2.5) × 10`: −25, −15, −5, 5, 15 and 25. `PIN_SPREAD`
// is one of the lengths passives leave as written ("What passives leave as
// written"). Facing right is `+x` (`specs/weapons.md`, The nearest enemy), so
// each dart's velocity is `(700, 0)`.
//
// WHY THE STARTS ARE READ ON THE FIRING TICK. `specs/world.md` ("One tick"),
// phase 5 creates a firing's projectiles "at the lamplighter's ... positions
// of this tick", and phase 6 has a new projectile "first moving on the next
// tick", so the snapshot after the firing tick holds each dart at its start.
//
// WHAT IS COMPARED. The specification numbers the darts but fixes no order for
// the ids a tick hands out, so the six offsets are compared as a sorted list
// against the sorted six: any build that placed them where the formula says
// passes, whichever dart it created first.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, facing right and read back before the firing, Hail armed and
// `weaponFire` the one switch on. That six darts fire is `hail-row`'s point;
// here the count is the precondition the offsets are read under.
//
// THE TOLERANCE. `REAL_EPS` on each coordinate, a copy of the player's center
// plus a product of two small numbers, and `MOTION_EPS` on each velocity
// component. Darts left unspread sit 5 to 25 units from where they belong.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HAIL_STATS, MOTION_EPS, PIN_SPREAD, REAL_EPS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { fireFromPosed } from "./evolved";

/** `(i − (n − 1) / 2) × PIN_SPREAD` for `i` in `0 .. n − 1`, ascending. */
const OFFSETS: readonly number[] = Array.from(
  { length: HAIL_STATS.amount },
  (_, i) => (i - (HAIL_STATS.amount - 1) / 2) * PIN_SPREAD,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts the six darts at x = player.x with y offsets −25 to 25 and velocity (700, 0)", async () => {
  isolate(h);
  h.debug.setFacing("right");
  assertEqual(
    h.snapshot().run.player.facing,
    "right",
    "the facing posed before the firing (specs/instrumentation.md, setFacing)",
  );

  const firing = await fireFromPosed(h, "hail");
  captureStill(h, "spread");

  const { player } = firing.after.run;
  assertEqual(
    firing.projectiles.length,
    HAIL_STATS.amount,
    "the darts the firing tick created (specs/evolutions.md, Hail)",
  );
  for (const dart of firing.projectiles) {
    assertNear(
      dart.x,
      player.x,
      REAL_EPS,
      `dart ${dart.id}'s x, against player.x (specs/evolutions.md, Hail)`,
    );
    assertNear(
      dart.vx,
      HAIL_STATS.speed,
      MOTION_EPS,
      `dart ${dart.id}'s vx, fired horizontally in the facing direction (specs/evolutions.md, Hail)`,
    );
    assertNear(
      dart.vy,
      0,
      MOTION_EPS,
      `dart ${dart.id}'s vy, fired horizontally (specs/evolutions.md, Hail)`,
    );
  }

  const offsets = firing.projectiles
    .map((dart) => dart.y - player.y)
    .sort((a, b) => a - b);
  for (let i = 0; i < offsets.length; i += 1) {
    assertNear(
      offsets[i],
      OFFSETS[i],
      REAL_EPS,
      `y offset ${i} of the sorted darts, against (i − 2.5) × PIN_SPREAD (specs/evolutions.md, Hail)`,
    );
  }
});
