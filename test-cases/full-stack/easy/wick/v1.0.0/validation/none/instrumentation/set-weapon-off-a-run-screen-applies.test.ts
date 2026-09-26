// Wick — instrumentation/set-weapon-off-a-run-screen-applies: setWeapon(0,
// 'pin', 1) issued on `title` puts Pin in the slot there.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "No operation asks how the caller got to it. The screen
// showing, the overlay open, and what a player would have had to do first are
// the route a player takes and are not an operation's conditions, so every
// operation below acts on the game from wherever it stands: `setHp` sets the
// health on `title` as readily as on `playing`, and `spawnEnemy` puts an enemy
// on the field whatever screen is up. What no operation does is refuse quietly,
// returning with the state as it was." Every other operation the rule covers is
// a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. The title is the screen a reset leaves, and
// its idle run holds no weapon, so slot `0` is the append the call makes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("applies the weapon the call named, from the title", async () => {
  const before = await h.snapshot();
  assertEqual(before.screen, "title", "the screen the call is made on");

  await h.debug.setWeapon(0, "pin", 1);
  await h.debug.reconcile();
  const after = await h.snapshot();
  assertEqual(after.run.weapons.length, 1, "how many slots are held");
  assertEqual(after.run.weapons[0]?.id, "pin", "the held weapon's id");
  assertEqual(after.run.weapons[0]?.level, 1, "the held weapon's level");
  assertEqual(after.screen, "title", "the screen the call left");

  await captureStill(h, "posed");
});
