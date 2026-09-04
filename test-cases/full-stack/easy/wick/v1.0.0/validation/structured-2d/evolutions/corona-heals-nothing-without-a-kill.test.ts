// evolutions/corona-heals-nothing-without-a-kill — a Corona pulse that hits
// without killing heals nothing.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Each
// enemy a pulse kills, one whose `hp` the pulse's own hit takes from above `0`
// to `0` or below, heals the player `CORONA_HEAL` (`1`) health on that tick,
// capped at `maxHp`." The heal is PER KILL, so a pulse that lands its damage
// and kills nothing must leave `hp` where it stood. A build that healed per
// pulse reads 51. What a pulse that DOES kill heals is
// `evolutions/corona-heals-per-kill`'s.
//
// WHERE THE HOUND STANDS. `INSIDE` (120) units out, inside the aura's 150
// radius and the 168 at which a hound's circle and the aura's overlap
// (`specs/weapons.md`, Shapes and overlap), and outside `PICKUP_RADIUS` (`48`)
// so nothing it might drop is drawn in. `CORONA_STATS` gives damage 12 and a
// hound holds 120 `hp` (`specs/enemies.md`), so the pulse hits it and leaves it
// standing.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Corona
// and that hound, `weaponFire` the one switch on, so nothing else fires and no
// contact or motion moves the reading. No Tinder is held, so `recovery` is
// `BASE_RECOVERY` (`0`) and the recovery step of every tick adds nothing
// (`specs/world.md`, Health and recovery), and no Tallow, so `maxHp` is
// `BASE_MAX_HP` (`100`) and the cap decides nothing.
//
// THE TOLERANCE. `REAL_EPS` on `hp`, the posed value read back unchanged.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNear } from "../assert";
import { CORONA_STATS, ENEMIES, PICKUP_RADIUS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { INSIDE, holdCorona } from "./evolved";

/** The `hp` posed: far enough below the cap that a heal would show. */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves hp at 50 on a pulse that hits a hound without killing it", async () => {
  if (!(INSIDE < CORONA_STATS.radius + ENEMIES.hound.radius)) {
    throw new Error("the hound must overlap the aura");
  }
  if (!(INSIDE > PICKUP_RADIUS)) {
    throw new Error("the hound must stand outside the pickup radius");
  }
  if (!(ENEMIES.hound.hp > CORONA_STATS.damage)) {
    throw new Error("one pulse must leave the hound standing");
  }

  isolate(h);
  h.debug.setHp(POSED_HP);
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  holdCorona(h);

  const pulsed = await advanceTicks(h, 1);
  captureStill(h, "unhealed");

  const struck = enemyById(pulsed, hound);
  assertEqual(
    struck !== undefined,
    true,
    `the hound standing after a pulse of ${CORONA_STATS.damage} (specs/weapons.md, Hits and death)`,
  );
  assertLessThan(
    struck?.hp ?? Number.NaN,
    ENEMIES.hound.hp,
    "the hound's hp after the pulse hit it",
  );
  assertNear(
    pulsed.run.player.hp,
    POSED_HP,
    REAL_EPS,
    "hp after a pulse that killed nothing (specs/evolutions.md, Corona)",
  );
});
