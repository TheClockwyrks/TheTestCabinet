// Wick — evolutions/corona-heals-nothing-without-a-kill: a Corona pulse that
// hits without killing heals nothing.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Each enemy
// a pulse kills, one whose `hp` the pulse's own hit takes from above `0` to `0`
// or below, heals the player `CORONA_HEAL` (`1`) health on that tick, capped at
// `maxHp`." The heal is PER KILL, so a pulse that lands its damage and kills
// nothing must leave `hp` where it stood. What a pulse that DOES kill heals is
// `evolutions/corona-heals-per-kill`'s.
//
// THE POSE. An isolated night, `hp` posed to 50, and one hound `100` units out
// — inside the `150 + 18` at which its circle overlaps the aura, and past
// `pickupRadius` (`48`) so nothing it might drop could reach the lamplighter. A
// hound holds `120` hp (`specs/enemies.md`) against `CORONA_STATS`' damage of
// `12`, so the pulse hits it and leaves it standing. `maxHp` is `BASE_MAX_HP`
// (`100`) with no Tallow held and `recovery` is `BASE_RECOVERY` (`0`) with no
// Tinder (`specs/passives.md`), so nothing else can move `hp` over the tick.
//
// WHAT IS READ. The hound's `hp` down by the pulse's damage, which is what
// makes this a pulse that HIT, and the lamplighter's `hp` still 50. A build
// that heals per pulse rather than per kill reads 51.
//
// TOLERANCE. `FLOAT_TOL` on `hp`, a real read back unchanged.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNear } from "../assert";
import { BASE_MAX_HP, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** The health the run is posed at, well under the cap. */
const POSED_HP = 50;

/** Where the hound stands: inside the aura, clear of every collection distance. */
const HOUND = { x: 100, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves hp at 50 on a pulse that hits a hound without killing it", async () => {
  await isolate(h);
  await h.debug.setHp(POSED_HP);
  const hound = await placeEnemyNear(h, "hound", HOUND.x, HOUND.y);
  const posed = await h.snapshot();
  assertEqual(posed.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertNear(player(posed).hp, POSED_HP, FLOAT_TOL, "hp as posed");

  const firing = await fireWeapon(h, "corona", 1);
  await captureStill(h, "unhealed");

  const struck = mustEnemy(firing.after, hound.id);
  assertLessThan(struck.hp, hound.hp, "the hound's hp after the pulse hit it");
  assertNear(
    player(firing.after).hp,
    POSED_HP,
    FLOAT_TOL,
    "hp after a pulse that killed nothing",
  );
});
