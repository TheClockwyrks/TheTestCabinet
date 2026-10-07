// Wick — instrumentation/snapshot-shape: on a posed run holding one of
// everything, `snapshot()` reports every documented field with its documented
// type, `almanacTab`, `almanacScroll`, and `run.hurtFlash` among them, nested
// entries included, with the values that were posed.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Snapshot shape": the block that lists every field of the object and of each
// nested `player`, `weapons[]`, `passives[]`, `enemies[]`, `projectiles[]`,
// `zones[]`, `gems[]`, and `pickups[]` entry, with its type; "`zones[].ttl` is
// `null` for a zone that never expires, and `width` and `height` appear on a
// slash alone"; "`nextOffers`: what `setNextOffers` queued, or `null`"; and
// the six posed outcomes, "each null while none is posed". The field lists
// below are that block, transcribed.
//
// THE POSE. An isolated run, every switch off so nothing moves what was
// posed, holding: Ember at level 3 and Brass at level 2, a moth at (200, 0), an
// Ember bolt at (100, 0) flying +x, an Oil Splash puddle at (50, 50), a medium
// gem at (300, 0) and a bread at (-200, 0) — both outside every pickup radius,
// so a tick would not take them — the tick posed to 4500, kills to 12, hp to
// 40, and a queued offer list. The values read back are the ones posed, exact,
// since a pose stores what it was handed; nothing derived is asserted here (the
// derived fields have their own items).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNull,
  assertTypeOf,
  assertUndefined,
} from "../assert";
import { WICK_DEBUG_VERSION, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  gemById,
  holdPassive,
  holdWeapon,
  isolate,
  pickupById,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  projectileById,
  zoneById,
  type Harness,
} from "../harness";

/** The top-level fields, in the order the block lists them. */
const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "menuIndex",
  "almanacTab",
  "almanacScroll",
  "spawning",
  "events",
  "despawning",
  "enemyMotion",
  "enemyContact",
  "weaponFire",
  "effectMotion",
  "drops",
  "progression",
  "run",
  "muted",
  "accumulator",
  "simTime",
] as const;

/** The fields of `run`. */
const RUN_FIELDS = [
  "tick",
  "time",
  "level",
  "xp",
  "xpToNext",
  "kills",
  "player",
  "hurtFlash",
  "maxHp",
  "armor",
  "moveSpeed",
  "pickupRadius",
  "weapons",
  "passives",
  "enemies",
  "projectiles",
  "zones",
  "gems",
  "pickups",
  "offers",
  "pool",
  "nextOffers",
  "pendingLevelUps",
  "chestResult",
  "spawnTimer",
  "spawnWindow",
  "firedEvents",
  "aliveCommons",
  "nextId",
  "nextSpawnAngle",
  "nextSwarmAngle",
  "nextSpawnType",
  "nextPuddleOffset",
  "nextStrikeTarget",
  "nextChestItem",
  "nextDrop",
] as const;

/** The numeric fields of `run`. */
const RUN_NUMBERS = [
  "tick",
  "time",
  "level",
  "xp",
  "xpToNext",
  "kills",
  "hurtFlash",
  "maxHp",
  "armor",
  "moveSpeed",
  "pickupRadius",
  "pendingLevelUps",
  "spawnTimer",
  "spawnWindow",
  "aliveCommons",
  "nextId",
] as const;

const ENEMY_FIELDS = [
  "id",
  "type",
  "x",
  "y",
  "hp",
  "maxHp",
  "heading",
  "age",
  "contactCooldown",
] as const;
const PROJECTILE_FIELDS = [
  "id",
  "weapon",
  "x",
  "y",
  "vx",
  "vy",
  "ax",
  "ay",
  "radius",
  "damage",
  "ttl",
  "pierce",
  "hits",
] as const;
const ZONE_FIELDS = [
  "id",
  "weapon",
  "kind",
  "x",
  "y",
  "radius",
  "damage",
  "ttl",
  "hits",
] as const;

const POSED_TICK = 4500;
const POSED_KILLS = 12;
const POSED_HP = 40;
const QUEUED: OfferId[] = ["pin", "lure"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports the whole documented shape from a posed run", async () => {
  isolate(h);
  holdWeapon(h, "ember", 3);
  holdPassive(h, "brass", 2);
  const moth = placeEnemy(h, "moth", 200, 0);
  const bolt = placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  const puddle = placePuddle(h, "oil-splash", 50, 50);
  const gem = placeGem(h, "medium", 300, 0);
  const bread = placePickup(h, "bread", -200, 0);
  h.debug.setTick(POSED_TICK);
  h.debug.setKills(POSED_KILLS);
  h.debug.setHp(POSED_HP);
  h.debug.setNextOffers(QUEUED);

  // Read before any tick, so what is read is exactly what was posed; the one
  // frame after is the picture of that run.
  const s = h.snapshot();
  await h.frameDraw();
  captureStill(h, "posed");

  for (const field of SNAPSHOT_FIELDS)
    assertHasProperty(s, field, "snapshot()");
  assertEqual(s.version, WICK_DEBUG_VERSION, "snapshot().version");
  assertTypeOf(s.screen, "string", "snapshot().screen");
  assertTypeOf(s.menuIndex, "number", "snapshot().menuIndex");
  for (const field of ["almanacTab", "almanacScroll"] as const) {
    assertTypeOf(s[field], "number", `snapshot().${field}`);
    assertEqual(s[field], 0, `snapshot().${field} on playing`);
  }
  for (const flag of [
    "spawning",
    "events",
    "despawning",
    "enemyMotion",
    "enemyContact",
    "weaponFire",
    "effectMotion",
    "drops",
    "progression",
    "muted",
  ] as const) {
    assertTypeOf(s[flag], "boolean", `snapshot().${flag}`);
  }
  for (const field of ["accumulator", "simTime"] as const) {
    assertTypeOf(s[field], "number", `snapshot().${field}`);
  }

  const { run } = s;
  for (const field of RUN_FIELDS)
    assertHasProperty(run, field, "snapshot().run");
  for (const field of RUN_NUMBERS) {
    assertTypeOf(run[field], "number", `snapshot().run.${field}`);
  }
  assertEqual(run.tick, POSED_TICK, "run.tick");
  assertEqual(run.kills, POSED_KILLS, "run.kills");

  // The player.
  for (const field of ["x", "y", "facing", "hp"] as const) {
    assertHasProperty(run.player, field, "snapshot().run.player");
  }
  assertEqual(run.player.x, 0, "run.player.x");
  assertEqual(run.player.y, 0, "run.player.y");
  assertEqual(run.player.facing, "right", "run.player.facing");
  assertEqual(run.player.hp, POSED_HP, "run.player.hp");
  assertEqual(run.hurtFlash, 0, "run.hurtFlash on a run that has taken no hit");

  // The loadout.
  assertDeepEqual(
    run.weapons,
    [{ id: "ember", level: 3, cooldown: 0 }],
    "run.weapons",
  );
  assertDeepEqual(run.passives, [{ id: "brass", level: 2 }], "run.passives");

  // The enemy.
  assertLength(run.enemies, 1, "run.enemies");
  const enemy = enemyById(s, moth);
  if (enemy === undefined) throw new Error("unreachable: one enemy posed");
  for (const field of ENEMY_FIELDS) {
    assertHasProperty(enemy, field, "snapshot().run.enemies[0]");
  }
  assertEqual(enemy.type, "moth", "enemies[0].type");
  assertEqual(enemy.x, 200, "enemies[0].x");
  assertEqual(enemy.y, 0, "enemies[0].y");
  for (const field of ["hp", "maxHp", "age", "contactCooldown"] as const) {
    assertTypeOf(enemy[field], "number", `enemies[0].${field}`);
  }
  assertTypeOf(enemy.heading.x, "number", "enemies[0].heading.x");
  assertTypeOf(enemy.heading.y, "number", "enemies[0].heading.y");

  // The projectile.
  assertLength(run.projectiles, 1, "run.projectiles");
  const shot = projectileById(s, bolt);
  if (shot === undefined) throw new Error("unreachable: one projectile posed");
  for (const field of PROJECTILE_FIELDS) {
    assertHasProperty(shot, field, "snapshot().run.projectiles[0]");
  }
  assertEqual(shot.weapon, "ember", "projectiles[0].weapon");
  assertEqual(shot.x, 100, "projectiles[0].x");
  assertEqual(shot.y, 0, "projectiles[0].y");
  assertEqual(shot.vx, 400, "projectiles[0].vx");
  assertEqual(shot.vy, 0, "projectiles[0].vy");
  assertEqual(shot.pierce, 0, "projectiles[0].pierce");
  for (const field of ["ax", "ay", "radius", "damage", "ttl"] as const) {
    assertTypeOf(shot[field], "number", `projectiles[0].${field}`);
  }
  assertDeepEqual(shot.hits, [], "projectiles[0].hits");

  // The zone: a puddle, which expires and carries no slash extent.
  assertLength(run.zones, 1, "run.zones");
  const zone = zoneById(s, puddle);
  if (zone === undefined) throw new Error("unreachable: one zone posed");
  for (const field of ZONE_FIELDS) {
    assertHasProperty(zone, field, "snapshot().run.zones[0]");
  }
  assertEqual(zone.weapon, "oil-splash", "zones[0].weapon");
  assertEqual(zone.kind, "puddle", "zones[0].kind");
  assertEqual(zone.x, 50, "zones[0].x");
  assertEqual(zone.y, 50, "zones[0].y");
  for (const field of ["radius", "damage", "ttl"] as const) {
    assertTypeOf(zone[field], "number", `zones[0].${field}`);
  }
  assertUndefined(zone.width, "zones[0].width on a puddle");
  assertUndefined(zone.height, "zones[0].height on a puddle");
  assertDeepEqual(zone.hits, [], "zones[0].hits");

  // The gem and the pickup.
  assertDeepEqual(
    gemById(s, gem),
    { id: gem, tier: "medium", x: 300, y: 0, attracted: false },
    "run.gems[0]",
  );
  assertDeepEqual(
    pickupById(s, bread),
    { id: bread, kind: "bread", x: -200, y: 0 },
    "run.pickups[0]",
  );

  // The overlay fields, off the overlay.
  assertDeepEqual(run.offers, [], "run.offers on playing");
  assertDeepEqual(run.pool, [], "run.pool on playing");
  assertDeepEqual(run.nextOffers, QUEUED, "run.nextOffers");
  assertNull(run.chestResult, "run.chestResult");
  assertDeepEqual(run.firedEvents, [], "run.firedEvents");

  // The posed outcomes, none posed.
  for (const field of [
    "nextSpawnAngle",
    "nextSwarmAngle",
    "nextSpawnType",
    "nextPuddleOffset",
    "nextStrikeTarget",
    "nextChestItem",
    "nextDrop",
  ] as const) {
    assertNull(run[field], `run.${field} while none is posed`);
  }
});
