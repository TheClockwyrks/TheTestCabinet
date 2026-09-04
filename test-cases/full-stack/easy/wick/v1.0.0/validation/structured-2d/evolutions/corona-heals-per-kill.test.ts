// evolutions/corona-heals-per-kill — each enemy a Corona pulse kills heals
// CORONA_HEAL.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Each
// enemy a pulse kills, one whose `hp` the pulse's own hit takes from above `0`
// to `0` or below, heals the player `CORONA_HEAL` (`1`) health on that tick,
// capped at `maxHp`." `CORONA_STATS` gives damage 12 and a moth holds 5 `hp`
// (`specs/enemies.md`), so one pulse kills all three moths inside the aura and
// heals three. With `hp` posed to 50 against a `maxHp` of `BASE_MAX_HP`
// (`100`) — no Tallow held — the pulse leaves `hp` at 53, short of the cap.
//
// THE OTHER HALF OF THE RULE. A heal PER KILL is nothing when there is nothing
// to kill, which is `evolutions/corona-heals-nothing-without-a-kill`'s.
//
// WHERE THE THREE MOTHS STAND. `INSIDE` (120) units out on three directions
// 120 degrees apart, each inside the aura's 150 radius and the 160 at which a
// moth's circle and the aura's overlap (`specs/weapons.md`, Shapes and
// overlap), and each outside `PICKUP_RADIUS` (`48`) — so the gems the kills
// drop are never drawn in, and the bread or draft a kill may drop
// (`specs/world.md`, The drop roll) lands 120 units out, far outside the
// `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (28) a pickup is collected within. The
// lamplighter never moves, so nothing but the heal touches `hp`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Corona
// and those three moths, `weaponFire` the one switch on, so nothing else fires
// and no contact or motion moves the reading. No Tinder is held, so `recovery`
// is `BASE_RECOVERY` (`0`) and the recovery step of every tick adds nothing
// (`specs/world.md`, Health and recovery).
//
// THE TOLERANCE. `REAL_EPS` on `hp`, the posed value plus three units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  BASE_MAX_HP,
  CORONA_HEAL,
  CORONA_STATS,
  ENEMIES,
  PICKUP_RADIUS,
  REAL_EPS,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  pointAt,
  type Harness,
} from "../harness";
import { INSIDE, holdCorona } from "./evolved";

/** The `hp` posed: far enough below the cap that three units fit. */
const POSED_HP = 50;

/** Three directions 120 degrees apart, each `INSIDE` units out. */
const POSTS: readonly number[] = [0, 120, 240];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp from 50 to 53 on the pulse that kills three moths", async () => {
  if (!(INSIDE < CORONA_STATS.radius + ENEMIES.moth.radius)) {
    throw new Error("the moths must overlap the aura");
  }
  if (!(INSIDE > PICKUP_RADIUS)) {
    throw new Error("the moths must stand outside the pickup radius");
  }
  if (!(ENEMIES.moth.hp <= CORONA_STATS.damage)) {
    throw new Error("one pulse must kill a moth");
  }
  if (!(POSED_HP + POSTS.length * CORONA_HEAL <= BASE_MAX_HP)) {
    throw new Error("the heal must fit under maxHp");
  }

  isolate(h);
  h.debug.setHp(POSED_HP);
  for (const angle of POSTS) {
    const at = pointAt({ x: 0, y: 0 }, angle, INSIDE);
    placeEnemyNear(h, "moth", at.x, at.y);
  }
  holdCorona(h);
  assertEqual(
    h.snapshot().run.enemies.length,
    POSTS.length,
    "the moths standing inside the aura before the pulse (specs/instrumentation.md, spawnEnemy)",
  );

  const killed = await advanceTicks(h, 1);
  captureStill(h, "healed");

  assertEqual(
    killed.run.enemies.length,
    0,
    `the moths left alive after a pulse of ${CORONA_STATS.damage} (specs/weapons.md, Hits and death)`,
  );
  assertNear(
    killed.run.player.hp,
    POSED_HP + POSTS.length * CORONA_HEAL,
    REAL_EPS,
    `hp after the pulse, ${CORONA_HEAL} for each of the ${POSTS.length} enemies it killed (specs/evolutions.md, Corona)`,
  );
});
