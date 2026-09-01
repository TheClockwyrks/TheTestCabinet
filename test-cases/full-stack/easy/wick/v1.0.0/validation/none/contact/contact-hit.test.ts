// contact/contact-hit — an overlapping enemy hits for its damage.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "On every
// tick, for every live enemy, the enemy's circle overlaps the lamplighter's when
// the distance between their centers is less than the enemy's radius plus
// `PLAYER_RADIUS`. An overlapping enemy whose `contactCooldown` is due lands a
// hit: `hp` falls by `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`". A rat is
// "Rat | `rat` | 15 | 120 | 8 | 12" in specs/enemies.md, so its damage is 8 and
// its radius 12; `PLAYER_RADIUS` is 12 (specs/world.md — "The lamplighter"), so
// a rat 20 units from the center overlaps by 4. "`armor` is `0` with no Brass
// held", and an enemy "spawns ... with `age` `0`, `contactCooldown` `0`"
// (specs/enemies.md), and a timer at `0` "stays due on every tick until it is
// set again" (specs/world.md — "Timers"), so the rat hits on the first tick it
// stands there. `BASE_MAX_HP` (`100`) less 8 is 92.
//
// THE DRIVE. An isolated night: nothing else alive, no weapon, no passive, and
// every faculty held but `enemyContact`, which is the one this point is about.
// `enemyMotion` stays off so the rat is tested at exactly the point it was posed.
// Recovery is `BASE_RECOVERY` (`0`) with no Tinder held, so the only thing that
// moves `hp` on the tick is the hit. One tick is run, and `hp` is read.
//
// THE TOLERANCE. `FLOAT_TOL`: `100 - 8` is exact in floating point, and the
// allowance covers a build that routes the figure through a multiplication of
// its own. The nearest wrong answer, a moth's 5 or a hit the floor of 1
// clipped, is whole units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { BASE_MAX_HP, ENEMIES, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** How far from the lamplighter's center the rat is posed: 20, inside 12 + 12. */
const RAT_OFFSET = 20;

/** The health one rat hit leaves, from full: `100 - 8`. */
const EXPECTED_HP = BASE_MAX_HP - ENEMIES.rat.damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the rat's 8 damage from hp on the tick it overlaps", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await placeEnemyNear(h, "rat", RAT_OFFSET, 0);

  const after = await h.step(1);

  // The HUD with the hit landed. Captured before the assertion, so a failing
  // build leaves the picture that shows why.
  await captureStill(h, "hit");

  assertNear(
    player(after).hp,
    EXPECTED_HP,
    FLOAT_TOL,
    "hp after one tick with a rat overlapping the lamplighter",
  );
});
