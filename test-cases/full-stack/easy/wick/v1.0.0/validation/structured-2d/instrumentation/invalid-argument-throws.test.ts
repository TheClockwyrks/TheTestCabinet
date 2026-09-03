// Wick — instrumentation/invalid-argument-throws: an argument outside its
// domain throws, leaves the state exactly as it was, and is never rounded or
// clamped into range.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// operations": "An argument outside the domain its operation states is
// invalid, and the call throws rather than guessing what was meant; no
// operation rounds, clamps, or otherwise normalizes an argument." Each call
// below sits just outside the domain its own heading states:
//   setTick: 0 to 35999             → 36000, −1
//   setLevel: at least 1            → 0
//   setXp: at least 0               → −1
//   setKills: a whole number        → 1.5
//   setSpawnTimer: at least 0       → −1
//   setFacing: "left" or "right"    → "up"
//   spawnEnemy: an EnemyId          → "ghost"
//   setWeapon: level 1 to 8 (base), 1 (evolved); slot 0 to weapons.length
//                                   → taper 9; pyre 2; slot 3 with one held
//   setPassive: level to maxLevel   → brass 4 (max 3)
//   spawnGem: a GemTier             → "huge"
//   setWeaponCooldown, removeWeapon: a held slot → 3 with one held
//   removePassive: a held slot      → 0 with none held
//   setGemAttracted: an id naming a gem → one that names none
//   spawnPickup: a PickupKind       → "coin"
//   spawnProjectile: one of six weapons → "taper"
//   spawnPuddle: oil-splash or blaze → "halo"
// The engineless `step(0)` and `advance(0)` have no counterpart here.
//
// THE POSE. An isolated run with Taper kept (one weapon held, no passive),
// each call, and the whole snapshot compared with the one before them: a
// value clamped into range would show as a changed field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { DAWN_TICK } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type WickDebugApi,
} from "../harness";

/** The surface with its argument types loosened, so a call outside a type's domain can be spelled. */
type Loose = { [K in keyof WickDebugApi]: (...args: never[]) => unknown };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws on each out-of-domain argument and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const d = h.debug as unknown as Loose;
  const unknownGem = before.run.nextId + 100;

  const calls: Array<[string, () => unknown]> = [
    ["setTick(36000)", () => d.setTick(DAWN_TICK as never)],
    ["setTick(-1)", () => d.setTick(-1 as never)],
    ["setLevel(0)", () => d.setLevel(0 as never)],
    ["setXp(-1)", () => d.setXp(-1 as never)],
    ["setKills(1.5)", () => d.setKills(1.5 as never)],
    ["setSpawnTimer(-1)", () => d.setSpawnTimer(-1 as never)],
    ["setFacing('up')", () => d.setFacing("up" as never)],
    [
      "spawnEnemy('ghost', 0, 0)",
      () => d.spawnEnemy("ghost" as never, 0 as never, 0 as never),
    ],
    [
      "setWeapon(0, 'taper', 9)",
      () => d.setWeapon(0 as never, "taper" as never, 9 as never),
    ],
    [
      "setWeapon(0, 'pyre', 2)",
      () => d.setWeapon(0 as never, "pyre" as never, 2 as never),
    ],
    [
      "setPassive(0, 'brass', 4)",
      () => d.setPassive(0 as never, "brass" as never, 4 as never),
    ],
    [
      "spawnGem('huge', 0, 0)",
      () => d.spawnGem("huge" as never, 0 as never, 0 as never),
    ],
    [
      "setWeapon(3, 'pin', 1) with one weapon held",
      () => d.setWeapon(3 as never, "pin" as never, 1 as never),
    ],
    [
      "setWeaponCooldown(3, 0) on an empty slot",
      () => d.setWeaponCooldown(3 as never, 0 as never),
    ],
    ["removeWeapon(3) on an empty slot", () => d.removeWeapon(3 as never)],
    [
      "removePassive(0) with no passive held",
      () => d.removePassive(0 as never),
    ],
    [
      "setGemAttracted on an id naming no gem",
      () => d.setGemAttracted(unknownGem as never, true as never),
    ],
    [
      "spawnPickup('coin', 0, 0)",
      () => d.spawnPickup("coin" as never, 0 as never, 0 as never),
    ],
    [
      "spawnProjectile('taper', 0, 0, 1, 0, 0)",
      () =>
        d.spawnProjectile(
          "taper" as never,
          0 as never,
          0 as never,
          1 as never,
          0 as never,
          0 as never,
        ),
    ],
    [
      "spawnPuddle('halo', 0, 0)",
      () => d.spawnPuddle("halo" as never, 0 as never, 0 as never),
    ],
  ];
  for (const [what, call] of calls) assertThrows(call, what);

  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(after, before, "snapshot after every refused call");
});
