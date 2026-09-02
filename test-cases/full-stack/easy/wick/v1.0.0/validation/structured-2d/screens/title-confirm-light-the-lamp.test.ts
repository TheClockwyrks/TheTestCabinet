// Wick — screens/title-confirm-light-the-lamp: confirming the first title item
// starts a run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`":
// `TITLE_ITEMS` is `LIGHT THE LAMP`, `HOW TO PLAY` "in that order",
// `menuIndex` is `0` on arriving, and `LIGHT THE LAMP` "Starts a fresh run,
// defined below, and sets `screen = playing`". "A fresh run" is that file's
// own paragraph: "the run clock at `0:00`, the lamplighter at the world origin
// `(0, 0)` with `hp = BASE_MAX_HP` (`100`) and `facing = "right"`, level `1`
// with `xp = 0` and `kills = 0`, Taper at level `1` alone in the first weapon
// slot". `specs/controls.md` binds `confirm` to `Enter` and `Space`.
//
// WHY THE CLOCK READS TICK 1. `specs/controls.md`, "Actions and bindings":
// "a frame whose press enters `playing` ... runs that frame's ticks, so a
// frame of `TICK_DT` whose press lights the lamp leaves the run at tick `1`".
// The press is delivered by one whole-tick frame here, so the run this reads
// is the fresh run one tick along, and the fields read are the ones that one
// tick of a run holding nothing cannot move: the level, the experience, the
// kills, the lamplighter with no movement key held, and which weapon sits in
// the first slot. What a fresh run holds BEFORE any tick is
// `screens/fresh-run-state`; the loadout's cooldown is left out here because
// Taper fires on the first tick it is held (`specs/state.md`, `WeaponSlot`).
//
// THE DRIVE. `reset` to the title screen and one real `Enter`, on the item the
// arrival highlights. The driver switches are on, as `reset` leaves them, so
// the tick this frame runs is the game's own.
//
// THE TOLERANCE. None: a screen name, a tick count, whole levels and counts,
// and a position the lamplighter never left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BASE_MAX_HP } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters playing on a fresh run when Enter takes LIGHT THE LAMP", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the press is made on");
  assertEqual(before.menuIndex, 0, "the highlighted item, LIGHT THE LAMP");

  const after = await tap(h, "Enter");
  captureStill(h, "started");

  assertEqual(after.screen, "playing", "the screen after confirming");
  assertEqual(after.run.tick, 1, "the run clock after the press's own tick");
  assertEqual(after.run.level, 1, "the level a fresh run starts at");
  assertEqual(after.run.xp, 0, "the experience a fresh run starts with");
  assertEqual(after.run.kills, 0, "the kills a fresh run starts with");
  assertEqual(after.run.player.x, 0, "the lamplighter's x at the world origin");
  assertEqual(after.run.player.y, 0, "the lamplighter's y at the world origin");
  assertEqual(
    after.run.player.facing,
    "right",
    "the facing a fresh run starts with",
  );
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp on a fresh run");
  assertLength(after.run.weapons, 1, "the weapons a fresh run holds");
  assertEqual(after.run.weapons[0].id, "taper", "the weapon in the first slot");
  assertEqual(after.run.weapons[0].level, 1, "that weapon's level");
});
