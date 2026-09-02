// Wick — evolutions/corona-heals-per-kill: each enemy a Corona pulse kills
// heals `CORONA_HEAL`, and a pulse that kills nothing heals nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Corona"): "Each enemy a pulse kills, one whose
//     `hp` the pulse's own hit takes from above `0` to `0` or below, heals the
//     player `CORONA_HEAL` (`1`) health on that tick, capped at `maxHp`."
//   - `specs/evolutions.md` ("Corona"): a pulse "deals `damage` to every enemy
//     whose circle overlaps the aura"; the fixed row has damage `12` and radius
//     `150`, and a moth has HP `5` while a hound has HP `120`
//     (`specs/enemies.md`), so one pulse kills every moth inside the aura and
//     leaves a hound standing.
//   - `specs/weapons.md` ("Hits and death"): "On any tick an enemy's `hp` is at
//     or below `0` after the hits the enemy dies on that tick."
//   - `specs/world.md` ("Health and recovery"): a heal "adds to `hp` and caps
//     it at the `maxHp` in force"; `maxHp` is `BASE_MAX_HP` (`100`) with no
//     Tallow held and `recovery` is `BASE_RECOVERY` (`0`) with no Tinder, so
//     nothing else moves `hp` over the span.
//   - `specs/world.md` ("Timers"): an interval of `0.5` seconds is
//     `round(0.5 × 60)` ticks, so the second pulse falls on tick 31, with the
//     moths already gone and the hound still standing.
//
// WHAT IS READ. With `hp` posed to 50, three moths and one hound inside the
// aura: after the first pulse `hp` reads 53, one `CORONA_HEAL` for each of the
// three kills and none for the hound the same pulse hit without killing; and
// after the second pulse, 30 ticks later, which hits the hound again and kills
// nothing, `hp` still reads 53. A build that heals per hit reads 54 and then
// 55, one that heals once per pulse reads 51, and one that heals not at all
// reads 50.
//
// WHY THE NIGHT IS POSED AS IT IS. Corona alone with three moths and one hound
// and nothing else, so the hits are four and the kills three and the two
// readings separate; the hound's 120 health outlasts both pulses of 12, so the
// second pulse is one that hits and kills; every driver switch off but
// `weaponFire`, so no contact, no recovery, and no other shape can move `hp`;
// `hp` posed 50 below `maxHp`, so the whole of the healing fits under the cap.
// The moths stand 40, 60, and 80 units out and the hound 100 the other way, so
// their gems and any bread land beyond the collection distance of
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS` (`12`) and nothing else
// heals over the span.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each `hp` reading: an exact sum of stated
// figures read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  CORONA_HEAL,
  CORONA_STATS,
  ENEMIES,
  FIGURE_TOLERANCE,
  ticksFor,
} from "../constants";
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

/** The probes a pulse kills: moths, HP 5 and radius 10. */
const KILLED = "moth";

/** Where the three moths stand along +x, all inside the fixed radius of 150. */
const KILLED_OFFSETS = [40, 60, 80];

/** The probe a pulse hits without killing: a hound, HP 120 and radius 18. */
const SURVIVOR = "hound";

/** Where the hound stands, along -x and inside the fixed radius. */
const SURVIVOR_OFFSET = -100;

/** The health the run is posed at, clear of `maxHp` by more than the healing. */
const POSED_HP = 50;

/** The ticks to the next pulse: round(0.5 × 60). */
const PERIOD_TICKS = ticksFor(CORONA_STATS.cooldown);

/** What the three kills heal: one `CORONA_HEAL` each. */
const HEALED = KILLED_OFFSETS.length * CORONA_HEAL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp from 50 to 53 on the pulse that kills three moths and holds it on the next", async () => {
  assertEqual(
    [...KILLED_OFFSETS, SURVIVOR_OFFSET].every(
      (offset) => Math.abs(offset) < CORONA_STATS.radius,
    ),
    true,
    "the probes' offsets against the aura's radius",
  );
  assertEqual(
    ENEMIES[SURVIVOR].hp > 2 * CORONA_STATS.damage,
    true,
    "the hound's health against the two pulses it takes",
  );
  assertEqual(
    POSED_HP + HEALED <= BASE_MAX_HP,
    true,
    "the healed health against maxHp, so the cap does not decide the reading",
  );
  armEvolved(h, "corona");
  for (const offset of KILLED_OFFSETS) spawnEnemyNear(h, KILLED, offset, 0);
  const hound = spawnEnemyNear(h, SURVIVOR, SURVIVOR_OFFSET, 0);
  h.debug.setHp(POSED_HP);
  enable(h, "weaponFire");
  const posed = h.snapshot();
  assertEqual(
    posed.run.enemies.length,
    KILLED_OFFSETS.length + 1,
    "enemies posed",
  );

  const killed = await h.tick(1);
  captureStill(h, "healed");

  assertEqual(killed.run.enemies.length, 1, "enemies left after the pulse");
  present(enemyById(killed, hound), "the hound after the first pulse");
  assertWithin(
    killed.run.player.hp,
    POSED_HP + HEALED,
    FIGURE_TOLERANCE,
    "hp after the pulse, one CORONA_HEAL for each of the three kills",
  );

  const later = await h.tick(PERIOD_TICKS);
  present(enemyById(later, hound), "the hound after the second pulse");
  assertWithin(
    later.run.player.hp,
    POSED_HP + HEALED,
    FIGURE_TOLERANCE,
    `hp after tick ${1 + PERIOD_TICKS}, the pulse that hit the hound and killed nothing`,
  );
});
