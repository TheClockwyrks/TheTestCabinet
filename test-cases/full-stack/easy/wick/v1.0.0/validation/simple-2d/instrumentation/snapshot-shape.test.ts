// instrumentation/snapshot-shape — on a posed run holding one of everything,
// `snapshot` returns every documented field with its documented type, the
// nested entries included, with values matching what was posed.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Snapshot shape":
// the block itself, field for field, restated as the field lists in
// `helpers.ts`; "The shape is fixed, and every field is present whatever the
// screen"; "`width` and `height` appear on a slash alone"; "Every zone's `x`,
// `y` is its center". The entry shapes are the ones specs/state.md declares
// for `EnemyState`, `ProjectileState`, `ZoneState`, `GemState`,
// `PickupState`, `WeaponSlot`, `PassiveSlot`, and `EnemyHit`.
//
// THE POSE. `poseBusyNight` holds a disturbed lamplighter, two weapons, two
// passives, four enemies, three projectiles, a puddle, three gems, and three
// pickups, every one through its own atomic operation with figures chosen to
// read back as themselves. One tick with every switch off then places Halo's
// aura under the placement rule and lets the shard sitting on the hound record
// a `hits` entry, so no list of the block is read empty. What each figure is
// WORTH belongs to the point of its own operation; what this decides is that
// every field is there, typed as documented, carrying the value posed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertTrue,
  assertWithin,
} from "../assert";
import {
  ENEMY_IDS,
  FIGURE_TOLERANCE,
  GEM_TIERS,
  PICKUP_KINDS,
  SCREENS,
  WICK_DEBUG_VERSION,
} from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  projectileById,
  zoneById,
  type Harness,
} from "../harness";
import {
  BUSY,
  ENEMY_FIELDS,
  GEM_FIELDS,
  HIT_FIELDS,
  PASSIVE_FIELDS,
  PICKUP_FIELDS,
  PLAYER_FIELDS,
  poseBusyNight,
  PROJECTILE_FIELDS,
  RUN_FIELDS,
  SNAPSHOT_FIELDS,
  WEAPON_FIELDS,
  ZONE_FIELDS,
} from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the whole documented shape off a posed run", async () => {
  const night = poseBusyNight(h);
  const s = await h.tick(1);
  captureStill(h, "posed");

  for (const field of SNAPSHOT_FIELDS)
    assertHasProperty(s, field, "snapshot()");
  assertEqual(s.version, WICK_DEBUG_VERSION, "snapshot().version");
  assertTrue(SCREENS.includes(s.screen), `snapshot().screen ${s.screen}`);
  assertEqual(typeof s.menuIndex, "number", "snapshot().menuIndex");
  for (const field of [
    "spawning",
    "events",
    "despawning",
    "enemyMotion",
    "enemyContact",
    "weaponFire",
    "effectMotion",
    "muted",
  ] as const) {
    assertEqual(typeof s[field], "boolean", `snapshot().${field}`);
  }
  for (const field of ["accumulator", "simTime", "rngState"] as const) {
    assertEqual(typeof s[field], "number", `snapshot().${field}`);
  }

  const { run } = s;
  for (const field of RUN_FIELDS)
    assertHasProperty(run, field, "snapshot().run");
  for (const field of [
    "tick",
    "time",
    "level",
    "xp",
    "xpToNext",
    "kills",
    "maxHp",
    "armor",
    "moveSpeed",
    "pickupRadius",
    "pendingLevelUps",
    "spawnTimer",
    "spawnWindow",
    "aliveCommons",
    "nextId",
  ] as const) {
    assertEqual(typeof run[field], "number", `snapshot().run.${field}`);
  }
  for (const field of [
    "weapons",
    "passives",
    "enemies",
    "projectiles",
    "zones",
    "gems",
    "pickups",
    "offers",
    "pool",
    "firedEvents",
  ] as const) {
    assertTrue(Array.isArray(run[field]), `snapshot().run.${field} is a list`);
  }
  assertEqual(
    run.nextOffers,
    null,
    "snapshot().run.nextOffers with nothing queued",
  );
  assertEqual(
    run.chestResult,
    null,
    "snapshot().run.chestResult off the overlay",
  );

  // The lamplighter, as posed.
  for (const field of PLAYER_FIELDS) {
    assertHasProperty(run.player, field, "snapshot().run.player");
  }
  assertEqual(run.player.x, BUSY.playerX, "player.x");
  assertEqual(run.player.y, BUSY.playerY, "player.y");
  assertEqual(run.player.facing, "left", "player.facing");
  assertEqual(run.player.hp, BUSY.hp, "player.hp");
  assertEqual(run.level, BUSY.level, "level");
  assertEqual(run.xp, BUSY.xp, "xp");
  assertEqual(run.kills, BUSY.kills, "kills");

  // The loadout, in slot order.
  assertEqual(run.weapons.length, 2, "the weapons held");
  for (const [slot, held] of run.weapons.entries()) {
    for (const field of WEAPON_FIELDS) {
      assertHasProperty(held, field, `snapshot().run.weapons[${slot}]`);
    }
  }
  assertEqual(run.weapons[night.haloSlot].id, "halo", "weapons[halo slot].id");
  assertEqual(
    run.weapons[night.emberSlot].id,
    "ember",
    "weapons[ember slot].id",
  );
  assertEqual(
    run.weapons[night.emberSlot].level,
    BUSY.emberLevel,
    "weapons[ember slot].level",
  );
  assertEqual(run.passives.length, 2, "the passives held");
  for (const [slot, held] of run.passives.entries()) {
    for (const field of PASSIVE_FIELDS) {
      assertHasProperty(held, field, `snapshot().run.passives[${slot}]`);
    }
  }
  assertEqual(run.passives[0].id, "tallow", "passives[0].id");
  assertEqual(run.passives[0].level, BUSY.tallowLevel, "passives[0].level");

  // The enemies, ascending by id, each with the documented fields.
  assertEqual(run.enemies.length, 4, "the enemies alive");
  for (const [i, enemy] of run.enemies.entries()) {
    for (const field of ENEMY_FIELDS) {
      assertHasProperty(enemy, field, `snapshot().run.enemies[${i}]`);
    }
    assertTrue(
      ENEMY_IDS.includes(enemy.type),
      `enemies[${i}].type ${enemy.type}`,
    );
    assertEqual(typeof enemy.heading.x, "number", `enemies[${i}].heading.x`);
    assertEqual(typeof enemy.heading.y, "number", `enemies[${i}].heading.y`);
    if (i > 0) {
      assertGreaterThan(
        enemy.id,
        run.enemies[i - 1].id,
        `enemies[${i}].id ascending`,
      );
    }
  }
  const moth = enemyById(s, night.moth);
  assertEqual(moth?.type, "moth", "the moth by its id");
  assertEqual(moth?.x, BUSY.playerX + 200, "the moth's posed x");
  assertEqual(moth?.y, BUSY.playerY, "the moth's posed y");

  // The projectiles, with the shard on the hound carrying a hits entry.
  assertEqual(run.projectiles.length, 3, "the projectiles in flight");
  for (const [i, shot] of run.projectiles.entries()) {
    for (const field of PROJECTILE_FIELDS) {
      assertHasProperty(shot, field, `snapshot().run.projectiles[${i}]`);
    }
    assertTrue(Array.isArray(shot.hits), `projectiles[${i}].hits is a list`);
  }
  const bolt = projectileById(s, night.bolt);
  assertEqual(bolt?.weapon, "ember", "the bolt by its id");
  assertEqual(bolt?.x, BUSY.playerX + 100, "the bolt's posed x");
  assertEqual(bolt?.vx, 400, "the bolt's posed vx");
  assertEqual(bolt?.pierce, 0, "the bolt's posed pierce");
  const shard = projectileById(s, night.shard);
  assertEqual(
    shard?.hits.length,
    1,
    "the shard's hits after the tick on the hound",
  );
  for (const field of HIT_FIELDS) {
    assertHasProperty(shard?.hits[0] ?? {}, field, "projectiles[].hits[0]");
  }
  assertEqual(
    shard?.hits[0].enemy,
    night.hound,
    "the shard's hit names the hound",
  );

  // The zones: the posed puddle and the aura the tick placed.
  assertEqual(run.zones.length, 2, "the zones: a puddle and the aura");
  for (const [i, zone] of run.zones.entries()) {
    for (const field of ZONE_FIELDS) {
      assertHasProperty(zone, field, `snapshot().run.zones[${i}]`);
    }
    assertEqual(
      "width" in zone || "height" in zone,
      false,
      `zones[${i}] (${zone.kind}) carries no slash extent`,
    );
  }
  const puddle = zoneById(s, night.puddle);
  assertEqual(puddle?.kind, "puddle", "the puddle by its id");
  assertEqual(puddle?.x, BUSY.playerX + 150, "the puddle's posed x");
  const aura = run.zones.find((zone) => zone.kind === "aura");
  assertEqual(aura?.weapon, "halo", "the aura the tick placed");
  assertEqual(
    aura?.ttl,
    null,
    "the aura's ttl, null for a zone that never expires",
  );

  // The gems and pickups.
  assertEqual(run.gems.length, 3, "the gems on the field");
  for (const [i, gem] of run.gems.entries()) {
    for (const field of GEM_FIELDS) {
      assertHasProperty(gem, field, `snapshot().run.gems[${i}]`);
    }
    assertTrue(GEM_TIERS.includes(gem.tier), `gems[${i}].tier ${gem.tier}`);
    assertEqual(
      gem.attracted,
      false,
      `gems[${i}].attracted, placed unattracted`,
    );
  }
  assertEqual(run.gems[0].id, night.gems[0], "gems[0].id");
  assertEqual(run.pickups.length, 3, "the pickups on the field");
  for (const [i, pickup] of run.pickups.entries()) {
    for (const field of PICKUP_FIELDS) {
      assertHasProperty(pickup, field, `snapshot().run.pickups[${i}]`);
    }
    assertTrue(PICKUP_KINDS.includes(pickup.kind), `pickups[${i}].kind`);
  }
  assertEqual(run.pickups[0].kind, "bread", "pickups[0].kind");
  assertEqual(run.pickups[0].x, BUSY.playerX + 600, "pickups[0].x");

  // The timer posed, counted down by the one tick since.
  assertWithin(
    run.spawnTimer,
    BUSY.spawnTimer,
    FIGURE_TOLERANCE,
    "spawnTimer, held by spawning off",
  );
});
