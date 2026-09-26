// Wick — evolutions/corona-heals-nothing-without-a-kill: a Corona pulse that
// hits without killing heals nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Corona"): "Each enemy a pulse kills, one whose
//     `hp` the pulse's own hit takes from above `0` to `0` or below, heals the
//     player `CORONA_HEAL` (`1`) health on that tick, capped at `maxHp`." The
//     heal is PER KILL, so a pulse that lands its damage and kills nothing
//     leaves `hp` where it stood.
//   - `specs/evolutions.md` ("Corona"): a pulse "deals `damage` to every enemy
//     whose circle overlaps the aura"; the fixed row has damage `12` and radius
//     `150`, and a hound has HP `120` (`specs/enemies.md`), so one pulse hits it
//     and leaves it standing.
//   - `specs/world.md` ("Health and recovery"): `maxHp` is `BASE_MAX_HP` (`100`)
//     with no Tallow held and `recovery` is `BASE_RECOVERY` (`0`) with no
//     Tinder, so nothing else moves `hp` over the tick.
//
// WHAT IS READ. The hound's HP down by the pulse's damage, which is what makes
// this a pulse that HIT, and `hp` still 50. A build that heals per pulse rather
// than per kill reads 51. What a pulse that DOES kill heals is
// `evolutions/corona-heals-per-kill`'s.
//
// WHY THE NIGHT IS POSED AS IT IS. Corona alone with one hound and nothing
// else, every driver switch off but `weaponFire`, so no contact, no recovery,
// and no other shape can move `hp`. The hound stands 100 units out, so anything
// it drops lands beyond the collection distance of `PICKUP_ITEM_RADIUS` (`16`)
// plus `PLAYER_RADIUS` (`12`).
//
// TOLERANCE. `FIGURE_TOLERANCE` on the `hp` reading: a stated figure read back
// unchanged.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertWithin } from "../assert";
import { CORONA_STATS, ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  present,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";

/** The probe a pulse hits without killing: a hound, HP 120 and radius 18. */
const SURVIVOR = "hound";

/** Where the hound stands, along -x and inside the fixed radius. */
const SURVIVOR_OFFSET = -100;

/** The health the run is posed at, clear of `maxHp` by more than any healing. */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves hp at 50 on a pulse that hits a hound without killing it", async () => {
  assertEqual(
    Math.abs(SURVIVOR_OFFSET) < CORONA_STATS.radius,
    true,
    "the hound's offset against the aura's radius",
  );
  assertEqual(
    ENEMIES[SURVIVOR].hp > CORONA_STATS.damage,
    true,
    "the hound's health against the pulse it takes",
  );
  armEvolved(h, "corona");
  const hound = spawnEnemyNear(h, SURVIVOR, SURVIVOR_OFFSET, 0);
  h.debug.setHp(POSED_HP);
  enable(h, "weaponFire");

  const pulsed = await h.tick(1);
  captureStill(h, "unhealed");

  const struck = present(enemyById(pulsed, hound), "the hound after the pulse");
  assertLessThan(
    struck.hp,
    ENEMIES[SURVIVOR].hp,
    "the hound's hp after the pulse hit it",
  );
  assertWithin(
    pulsed.run.player.hp,
    POSED_HP,
    FIGURE_TOLERANCE,
    "hp after a pulse that killed nothing",
  );
});
