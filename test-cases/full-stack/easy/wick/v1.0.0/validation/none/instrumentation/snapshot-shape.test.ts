// Wick — instrumentation/snapshot-shape: on a posed run holding one of
// everything, `snapshot()` returns every field the specification documents with
// its documented type, the nested entries included, and the values are the ones
// that were posed.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape"):
// the block itself, field for field, which `constants.ts` restates as
// `SNAPSHOT_FIELDS`, `RUN_FIELDS`, and the per-entry lists; "The shape is fixed,
// and every field is present whatever the screen"; "Values are plain numbers,
// strings, booleans, and plain objects". Each posed value is read back against
// the operation that posed it: `spawnEnemy` "centered at `(x, y)`",
// `spawnProjectile` "centered at `(x, y)` with velocity `(vx, vy)`", `spawnGem`
// "one unattracted gem of `tier`", `spawnPickup` "one pickup of `kind`",
// `setWeapon` "Puts weapon `id` ... at `level` in `slot`", `setPassive` the
// same.
//
// WHY THE WORLD IS POSED AS IT IS. A shape check over an empty run reads every
// list off `[]` and proves nothing about the entries; so the isolated night is
// filled with one of each kind, every faculty held so nothing moves or hits
// between the pose and the read, and the snapshot is taken with no tick run —
// what is read is exactly what was posed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNear,
  assertNull,
  assertTrue,
} from "../assert";
import {
  ENEMY_FIELDS,
  GEM_FIELDS,
  PASSIVE_SLOT_FIELDS,
  PICKUP_FIELDS,
  PLAYER_FIELDS,
  POSITION_TOL,
  PROJECTILE_FIELDS,
  RUN_FIELDS,
  SCREENS,
  SNAPSHOT_FIELDS,
  SWITCH_NAMES,
  WEAPON_SLOT_FIELDS,
  WICK_DEBUG_VERSION,
  ZONE_FIELDS,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

const MOTH_AT = { x: 200, y: 0 };
const BOLT = { x: 100, y: 0, vx: 400, vy: 0, pierce: 0 };
const PUDDLE_AT = { x: 50, y: 50 };
const GEM_AT = { x: -200, y: 0 };
const BREAD_AT = { x: 0, y: -200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every name in `fields` is a property of `value`, and `value` is a plain object. */
function requireFields(
  value: unknown,
  fields: readonly string[],
  what: string,
): asserts value is Record<string, unknown> {
  assertEqual(typeof value, "object", `${what} is an object`);
  assertTrue(value !== null, `${what} is not null`);
  for (const field of fields) {
    assertHasProperty(value as object, field, what);
  }
}

it("reports the whole documented shape, with the posed values", async () => {
  await isolate(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "bellows", 2);
  await placeEnemy(h, "moth", MOTH_AT.x, MOTH_AT.y);
  await placeProjectile(h, "ember", BOLT.x, BOLT.y, BOLT.vx, BOLT.vy, BOLT.pierce);
  await placePuddle(h, "oil-splash", PUDDLE_AT.x, PUDDLE_AT.y);
  await placeGem(h, "medium", GEM_AT.x, GEM_AT.y);
  await placePickup(h, "bread", BREAD_AT.x, BREAD_AT.y);
  await captureStill(h, "posed");

  const s = await h.snapshot();

  // The top level, every field present with its documented type.
  requireFields(s, SNAPSHOT_FIELDS, "snapshot()");
  assertEqual(s.version, WICK_DEBUG_VERSION, "snapshot().version");
  assertContains(SCREENS, s.screen, "snapshot().screen");
  assertEqual(typeof s.menuIndex, "number", "snapshot().menuIndex");
  assertEqual(typeof s.autoStep, "boolean", "snapshot().autoStep");
  for (const name of SWITCH_NAMES) {
    assertEqual(typeof s[name], "boolean", `snapshot().${name}`);
  }
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");
  assertEqual(typeof s.accumulator, "number", "snapshot().accumulator");
  assertEqual(typeof s.simTime, "number", "snapshot().simTime");
  assertEqual(typeof s.rngState, "number", "snapshot().rngState");

  // The run.
  const run = s.run;
  requireFields(run, RUN_FIELDS, "snapshot().run");
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
  assertNull(run.nextOffers, "snapshot().run.nextOffers with nothing queued");
  assertNull(run.chestResult, "snapshot().run.chestResult with no chest open");

  // The lamplighter.
  requireFields(run.player, PLAYER_FIELDS, "snapshot().run.player");
  assertEqual(typeof run.player.x, "number", "run.player.x");
  assertEqual(typeof run.player.y, "number", "run.player.y");
  assertContains(["left", "right"], run.player.facing, "run.player.facing");
  assertEqual(typeof run.player.hp, "number", "run.player.hp");

  // The loadout, as posed.
  assertLength(run.weapons, 1, "the weapons held");
  requireFields(run.weapons[0], WEAPON_SLOT_FIELDS, "run.weapons[0]");
  assertDeepEqual(
    { id: run.weapons[0]?.id, level: run.weapons[0]?.level },
    { id: "ember", level: 3 },
    "the posed weapon",
  );
  assertEqual(typeof run.weapons[0]?.cooldown, "number", "run.weapons[0].cooldown");
  assertLength(run.passives, 1, "the passives held");
  requireFields(run.passives[0], PASSIVE_SLOT_FIELDS, "run.passives[0]");
  assertDeepEqual(run.passives[0], { id: "bellows", level: 2 }, "the posed passive");

  // The enemy, as posed.
  assertLength(run.enemies, 1, "the enemies alive");
  const moth = run.enemies[0]!;
  requireFields(moth, ENEMY_FIELDS, "run.enemies[0]");
  assertEqual(moth.type, "moth", "run.enemies[0].type");
  assertNear(moth.x, MOTH_AT.x, POSITION_TOL, "run.enemies[0].x");
  assertNear(moth.y, MOTH_AT.y, POSITION_TOL, "run.enemies[0].y");
  for (const field of ["id", "hp", "maxHp", "age", "contactCooldown"] as const) {
    assertEqual(typeof moth[field], "number", `run.enemies[0].${field}`);
  }
  requireFields(moth.heading, ["x", "y"], "run.enemies[0].heading");
  assertEqual(typeof moth.heading.x, "number", "run.enemies[0].heading.x");
  assertEqual(typeof moth.heading.y, "number", "run.enemies[0].heading.y");

  // The projectile, as posed.
  assertLength(run.projectiles, 1, "the projectiles live");
  const bolt = run.projectiles[0]!;
  requireFields(bolt, PROJECTILE_FIELDS, "run.projectiles[0]");
  assertEqual(bolt.weapon, "ember", "run.projectiles[0].weapon");
  assertNear(bolt.x, BOLT.x, POSITION_TOL, "run.projectiles[0].x");
  assertNear(bolt.y, BOLT.y, POSITION_TOL, "run.projectiles[0].y");
  assertNear(bolt.vx, BOLT.vx, POSITION_TOL, "run.projectiles[0].vx");
  assertNear(bolt.vy, BOLT.vy, POSITION_TOL, "run.projectiles[0].vy");
  assertEqual(bolt.pierce, BOLT.pierce, "run.projectiles[0].pierce");
  for (const field of ["id", "ax", "ay", "radius", "damage", "ttl"] as const) {
    assertEqual(typeof bolt[field], "number", `run.projectiles[0].${field}`);
  }
  assertTrue(Array.isArray(bolt.hits), "run.projectiles[0].hits is a list");

  // The zone, as posed.
  assertLength(run.zones, 1, "the zones live");
  const puddle = run.zones[0]!;
  requireFields(puddle, ZONE_FIELDS, "run.zones[0]");
  assertEqual(puddle.kind, "puddle", "run.zones[0].kind");
  assertEqual(puddle.weapon, "oil-splash", "run.zones[0].weapon");
  assertNear(puddle.x, PUDDLE_AT.x, POSITION_TOL, "run.zones[0].x");
  assertNear(puddle.y, PUDDLE_AT.y, POSITION_TOL, "run.zones[0].y");
  for (const field of ["id", "radius", "damage"] as const) {
    assertEqual(typeof puddle[field], "number", `run.zones[0].${field}`);
  }
  assertEqual(typeof puddle.ttl, "number", "run.zones[0].ttl on a puddle");
  assertTrue(Array.isArray(puddle.hits), "run.zones[0].hits is a list");

  // The gem and the pickup, as posed.
  assertLength(run.gems, 1, "the gems on the field");
  const gem = run.gems[0]!;
  requireFields(gem, GEM_FIELDS, "run.gems[0]");
  assertEqual(gem.tier, "medium", "run.gems[0].tier");
  assertNear(gem.x, GEM_AT.x, POSITION_TOL, "run.gems[0].x");
  assertNear(gem.y, GEM_AT.y, POSITION_TOL, "run.gems[0].y");
  assertEqual(gem.attracted, false, "run.gems[0].attracted");
  assertEqual(typeof gem.id, "number", "run.gems[0].id");
  assertLength(run.pickups, 1, "the pickups on the field");
  const bread = run.pickups[0]!;
  requireFields(bread, PICKUP_FIELDS, "run.pickups[0]");
  assertEqual(bread.kind, "bread", "run.pickups[0].kind");
  assertNear(bread.x, BREAD_AT.x, POSITION_TOL, "run.pickups[0].x");
  assertNear(bread.y, BREAD_AT.y, POSITION_TOL, "run.pickups[0].y");
  assertEqual(typeof bread.id, "number", "run.pickups[0].id");
});
