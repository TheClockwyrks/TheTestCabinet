// Wick — instrumentation/placement-runs-under-switches: with both `weaponFire`
// and `effectMotion` off, holding Halo still creates its aura on the next
// `playing` tick, and the aura follows a posed lamplighter position on the tick
// after.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "Placement is gated by neither `weaponFire` nor `effectMotion`:
// on every `playing` tick, whatever the two hold, the placement part of phase 5
// of `specs/world.md` runs, so an aura or a lantern set is created, removed,
// re-centered, and resized exactly as that phase states." specs/world.md phase
// 5: "an aura ... is created on a tick its weapon is held and none exists ...
// the aura's center ... placed about the lamplighter's position of this tick".
// specs/weapons.md — Halo: "one zone of kind `aura`, a circle of `radius`
// centered on the player's center every tick". The center is read exactly.
//
// WHY THE WORLD IS POSED AS IT IS. Every switch is off, so the aura can only
// come from placement; the lamplighter is then moved by a pose, and the tick
// after must re-center the aura on the new position.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

const MOVED_TO = { x: 300, y: -120 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places and re-centers the aura with weaponFire and effectMotion off", async () => {
  const posed = await isolate(h);
  assertEqual(posed.weaponFire, false, "weaponFire during the scenario");
  assertEqual(posed.effectMotion, false, "effectMotion during the scenario");
  await holdWeapon(h, "halo", 1);

  const placed = await h.step(1);
  const auras = zonesOfKind(placed, "aura");
  assertLength(auras, 1, "the aura on the tick after Halo is held");
  assertEqual(auras[0]?.weapon, "halo", "the aura's weapon");
  assertEqual(auras[0]?.x, placed.run.player.x, "the aura's x on the lamplighter");
  assertEqual(auras[0]?.y, placed.run.player.y, "the aura's y on the lamplighter");

  await h.debug.setPlayerPosition(MOVED_TO.x, MOVED_TO.y);
  const moved = await h.step(1);
  await captureStill(h, "placed");
  const followed = zonesOfKind(moved, "aura");
  assertLength(followed, 1, "the aura after the lamplighter moved");
  assertEqual(followed[0]?.x, MOVED_TO.x, "the aura's x after the move");
  assertEqual(followed[0]?.y, MOVED_TO.y, "the aura's y after the move");
});
