// Wick — instrumentation/invalid-argument-throws: every call the point names
// hands its operation an argument outside its domain, throws, and leaves the
// state exactly as it was; no operation rounds or clamps an argument into
// range.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "An argument outside the domain its operation states is
// invalid, and the call throws rather than guessing what was meant; no
// operation rounds, clamps, or otherwise normalizes an argument." Each call's
// domain is its own heading's: `setTick` "`0` to ... `35999`"; `setLevel` "at
// least `1`"; `setXp` "at least `0`"; `setKills` "a whole number"; `setSpawnTimer`
// "at least `0`"; `setFacing` "`"left"` or `"right"`"; `spawnEnemy` "an
// `EnemyId`"; `setWeapon` "`level` is `1` to `MAX_WEAPON_LEVEL` for a base
// weapon and `1` for an evolved one" and "`slot` is `0` to `weapons.length`";
// `setPassive` "`1` to the passive's `maxLevel`", Brass's being 3; `spawnGem`
// "a `GemTier`"; `setWeaponCooldown` and `removeWeapon` "a held slot";
// `removePassive` "a held slot"; `setGemAttracted` "an `id` that names no gem
// is invalid"; `spawnPickup` "a `PickupKind`"; `spawnProjectile` "one of
// `ember`, `pin`, `shard`, `sconce`, `beacon`, and `hail`"; `spawnPuddle` "one
// of `oil-splash` and `blaze`"; `step` "a whole number of at least `1`";
// `advance` "a real number above `0`". The comparison across each refused
// call is exact equality of the state a pose governs.
//
// WHY THE WORLD IS POSED AS IT IS. The fresh run's Taper is kept as the one
// held weapon, so slot 3 is empty and slot 0 is held, and no passive is held;
// every argument is the nearest figure outside its domain, so a build that
// clamps lands on a valid value and changes the state, which is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import { DAWN_TICK } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  posedState,
  type Harness,
} from "../harness";

/** The surface with its argument types loosened, for calls outside the domain. */
type LooseSurface = Record<string, (...args: unknown[]) => Promise<unknown>>;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on every argument outside its domain and leaves the state as it was", async () => {
  await isolate(h, { keepTaper: true });
  const before = await h.snapshot();
  const api = h.debug as unknown as LooseSurface;

  const calls: [string, unknown[]][] = [
    ["setTick", [DAWN_TICK]],
    ["setTick", [-1]],
    ["setLevel", [0]],
    ["setXp", [-1]],
    ["setKills", [1.5]],
    ["setSpawnTimer", [-1]],
    ["setFacing", ["up"]],
    ["spawnEnemy", ["ghost", 0, 0]],
    ["setWeapon", [0, "taper", 9]],
    ["setWeapon", [0, "pyre", 2]],
    ["setPassive", [0, "brass", 4]],
    ["spawnGem", ["huge", 0, 0]],
    ["setWeapon", [3, "pin", 1]],
    ["setWeaponCooldown", [3, 0]],
    ["removeWeapon", [3]],
    ["removePassive", [0]],
    ["setGemAttracted", [before.run.nextId + 1000, true]],
    ["spawnPickup", ["coin", 0, 0]],
    ["spawnProjectile", ["taper", 0, 0, 1, 0, 0]],
    ["spawnPuddle", ["halo", 0, 0]],
    ["step", [0]],
    ["advance", [0]],
  ];

  for (const [name, args] of calls) {
    const shown = `${name}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
    await assertRejects(() => api[name]!(...args), shown);
    assertDeepEqual(
      posedState(await h.snapshot()),
      posedState(before),
      `the state across the refused ${shown}`,
    );
  }
  await captureStill(h, "refused");
});
