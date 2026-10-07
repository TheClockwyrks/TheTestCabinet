// Wick — evolutions/corona-heals-per-kill: each enemy a Corona pulse kills
// heals the lamplighter `CORONA_HEAL`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Each enemy
// a pulse kills, one whose `hp` the pulse's own hit takes from above `0` to `0`
// or below, heals the player `CORONA_HEAL` (`1`) health on that tick, capped at
// `maxHp`." `CORONA_STATS` gives damage `12` and radius `150`, times
// multipliers of `1` with no passive held, and a moth has `5` hp
// (`specs/enemies.md`), unscaled at a run clock of `0`, so a pulse takes each of
// three moths from `5` to `−7` and kills all three. `maxHp` is `BASE_MAX_HP`
// (`100`) with no Tallow held and `recovery` is `BASE_RECOVERY` (`0`) with no
// Tinder (`specs/passives.md`). So from `hp` `50` the pulse that kills them
// leaves `53`, under the cap; and the next pulse, `round(0.5 × 60)` = `30` ticks
// later over an empty night, leaves `53` still.
//
// THE POSE. An isolated night, `hp` posed to 50, three moths at `100` units out
// in three directions — inside the `150 + 10` at which their circles overlap the
// aura, and past `pickupRadius` (`48`) and the `PICKUP_ITEM_RADIUS +
// PLAYER_RADIUS` (`28`) at which a bread would be collected, so nothing their
// deaths drop reaches the lamplighter and the only change to `hp` is the heal.
// Corona is held at level 1 and pulsed through the shared `fireWeapon`.
//
// TOLERANCE. `FLOAT_TOL` on `hp`, a real the heal adds three whole units to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, CORONA_HEAL, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";
import { MOTH_HP } from "./stage";

/** The health the run is posed at, well under the cap. */
const POSED_HP = 50;

/** The three probes, inside the aura and clear of every collection distance. */
const PROBES = [
  { x: 100, y: 0 },
  { x: 0, y: 100 },
  { x: -100, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises hp from 50 to 53 on the pulse that kills three moths and leaves it there on the next pulse", async () => {
  await isolate(h);
  await h.debug.setHp(POSED_HP);
  for (const probe of PROBES) {
    const moth = await placeEnemyNear(h, "moth", probe.x, probe.y);
    assertEqual(moth.hp, MOTH_HP, `moth ${moth.id}'s hp as posed`);
  }
  const posed = await h.snapshot();
  assertEqual(posed.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertNear(player(posed).hp, POSED_HP, FLOAT_TOL, "hp as posed");

  const firing = await fireWeapon(h, "corona", 1);
  await captureStill(h, "healed");

  assertEqual(
    firing.after.run.enemies.length,
    0,
    "enemies left alive after the pulse",
  );
  const healed = POSED_HP + PROBES.length * CORONA_HEAL;
  assertNear(
    player(firing.after).hp,
    healed,
    FLOAT_TOL,
    "hp after the pulse that killed three moths",
  );
});
