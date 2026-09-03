// evolutions/pyre-heals-per-hit — each enemy a Pyre slash hits heals
// PYRE_HEAL.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Pyre"): "Each enemy
// a Pyre slash hits heals the player `PYRE_HEAL` (`1`) health on the tick of
// the hit, capped at `maxHp`." So three enemies inside one slash heal three,
// and with `hp` posed to 50 against a `maxHp` of `BASE_MAX_HP` (`100`) — no
// Tallow held — the firing tick leaves `hp` at 53, short of the cap.
//
// WHERE THE THREE MOTHS STAND. `PYRE_STATS` gives width 200 and height 60, and
// with no passive held `areaMul` is 1 (`specs/passives.md`), so the facing
// rectangle covers `x` from the player's `x` to 200 beyond it and `y` within
// 30 of the player's `y` (`specs/evolutions.md`, Pyre: "one extending `width`
// in the facing direction from the player's `x` ... each centered vertically
// on the player's `y`"). The three stand on that axis at 60, 110 and 160 units
// ahead, each inside the rectangle and each at least a radius clear of the
// mirrored rectangle behind the player, so the slash that reaches them is one
// slash reaching three enemies rather than two slashes reaching one each. All
// three stand past `PICKUP_RADIUS` (`48`), so the gems they drop are never
// drawn in and nothing else touches `hp`.
//
// WHY THE HEAL IS THE WHOLE READING. Pyre deals 60 and a moth holds 5 `hp`
// (`specs/enemies.md`), so all three die on the firing tick; the heal is
// stated per HIT rather than per kill, and the three hits are what the
// arrangement fixes. That the slash reached them is read first, as the
// precondition, so a build whose geometry missed fails on the count of live
// enemies rather than on a heal that was never owed.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Pyre
// and the three moths, every driver switch off but `weaponFire`: no contact
// hit, no enemy motion, and no other weapon. No Tinder is held, so `recovery`
// is `BASE_RECOVERY` (`0`) and the tick's recovery step adds nothing
// (`specs/world.md`, Health and recovery).
//
// THE TOLERANCE. `REAL_EPS` on `hp`, the posed value plus three units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  PICKUP_RADIUS,
  PYRE_HEAL,
  PYRE_STATS,
  REAL_EPS,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { fireFromPosed } from "./evolved";

/** The `hp` posed: far enough below the cap that three units fit. */
const POSED_HP = 50;

/** Where the three moths stand ahead of the lamplighter, inside the slash. */
const POSTS: readonly number[] = [60, 110, 160];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp from 50 to 53 on the tick a slash hits three moths", async () => {
  for (const post of POSTS) {
    if (!(post + ENEMIES.moth.radius <= PYRE_STATS.width)) {
      throw new Error(`a moth at ${post} must lie inside the slash`);
    }
    if (!(post > ENEMIES.moth.radius)) {
      throw new Error(`a moth at ${post} must clear the mirrored slash`);
    }
    if (!(post > PICKUP_RADIUS)) {
      throw new Error(`a moth at ${post} must stand outside the pickup radius`);
    }
  }
  if (!(POSED_HP + POSTS.length * PYRE_HEAL <= BASE_MAX_HP)) {
    throw new Error("the heal must fit under maxHp");
  }

  isolate(h);
  h.debug.setHp(POSED_HP);
  for (const post of POSTS) placeEnemyNear(h, "moth", post, 0);
  assertEqual(
    h.snapshot().run.enemies.length,
    POSTS.length,
    "the moths standing in the slash before the firing (specs/instrumentation.md, spawnEnemy)",
  );

  const firing = await fireFromPosed(h, "pyre");
  captureStill(h, "healed");

  assertEqual(
    firing.after.run.enemies.length,
    0,
    `the moths left alive after a slash of ${PYRE_STATS.damage} reached all three (specs/weapons.md, Hits and death)`,
  );
  assertNear(
    firing.after.run.player.hp,
    POSED_HP + POSTS.length * PYRE_HEAL,
    REAL_EPS,
    `hp after the firing tick, ${PYRE_HEAL} for each of the ${POSTS.length} enemies the slash hit (specs/evolutions.md, Pyre)`,
  );
});
