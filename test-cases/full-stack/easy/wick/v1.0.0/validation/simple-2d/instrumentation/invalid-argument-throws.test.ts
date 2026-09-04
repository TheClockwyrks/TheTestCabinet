// instrumentation/invalid-argument-throws — every listed call with an
// argument outside its operation's stated domain throws and leaves the state
// exactly as it was, and no operation rounds or clamps an argument into range.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The operations":
// "An argument outside the domain its operation states is invalid, and the
// call throws rather than guessing what was meant; no operation rounds,
// clamps, or otherwise normalizes an argument", and each operation's own
// domain: `setTick` "0 to DAWN_TIME × TICK_HZ − 1 (35999)"; `setLevel` "at
// least 1"; `setXp` "at least 0"; `setKills` "a whole number"; `setSpawnTimer`
// "at least 0"; `setFacing` "left or right"; `spawnEnemy` "an EnemyId";
// `setWeapon` "level is 1 to MAX_WEAPON_LEVEL for a base weapon and 1 for an
// evolved one", "slot is 0 to weapons.length"; `setWeaponCooldown` and
// `removeWeapon` "a held slot"; `setPassive` "level is 1 to the passive's
// maxLevel" (Brass 3); `removePassive` "a held slot"; `spawnGem` "a GemTier";
// `setGemAttracted` "an id that names no gem is invalid"; `spawnPickup` "a
// PickupKind"; `spawnProjectile` "one of ember, pin, shard, sconce, beacon,
// and hail"; `spawnPuddle` "one of oil-splash and blaze". The engineless
// `step(0)` and `advance(0)` have no counterpart on this engine's surface.
//
// THE POSE. An isolated run keeping its Taper (one weapon held, no passive,
// no gem), so the slot and id refusals have something to be told apart from.
// Each call in turn, the throw, and the whole snapshot against the reading
// before, so a clamp or a rounding shows as a changed field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { DAWN_TICK } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses every argument outside its domain and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const debug = h.debug as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const noGem = before.run.nextId + 1;

  const calls: readonly [string, () => unknown][] = [
    ["setTick(36000)", () => debug.setTick(DAWN_TICK)],
    ["setTick(-1)", () => debug.setTick(-1)],
    ["setLevel(0)", () => debug.setLevel(0)],
    ["setXp(-1)", () => debug.setXp(-1)],
    ["setKills(1.5)", () => debug.setKills(1.5)],
    ["setSpawnTimer(-1)", () => debug.setSpawnTimer(-1)],
    ["setFacing('up')", () => debug.setFacing("up")],
    ["spawnEnemy('ghost', 0, 0)", () => debug.spawnEnemy("ghost", 0, 0)],
    ["setWeapon(0, 'taper', 9)", () => debug.setWeapon(0, "taper", 9)],
    ["setWeapon(0, 'pyre', 2)", () => debug.setWeapon(0, "pyre", 2)],
    ["setPassive(0, 'brass', 4)", () => debug.setPassive(0, "brass", 4)],
    ["spawnGem('huge', 0, 0)", () => debug.spawnGem("huge", 0, 0)],
    [
      "setWeapon(3, 'pin', 1) with one weapon held",
      () => debug.setWeapon(3, "pin", 1),
    ],
    [
      "setWeaponCooldown(3, 0) on an empty slot",
      () => debug.setWeaponCooldown(3, 0),
    ],
    ["removeWeapon(3) on an empty slot", () => debug.removeWeapon(3)],
    ["removePassive(0) with no passive held", () => debug.removePassive(0)],
    [
      "setGemAttracted on an id that names no gem",
      () => debug.setGemAttracted(noGem, true),
    ],
    ["spawnPickup('coin', 0, 0)", () => debug.spawnPickup("coin", 0, 0)],
    [
      "spawnProjectile('taper', 0, 0, 1, 0, 0)",
      () => debug.spawnProjectile("taper", 0, 0, 1, 0, 0),
    ],
    ["spawnPuddle('halo', 0, 0)", () => debug.spawnPuddle("halo", 0, 0)],
  ];
  for (const [what, call] of calls) {
    assertThrows(call, what);
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot after ${what} was refused`,
    );
  }
  await h.tick(1);
  captureStill(h, "refused");
});
