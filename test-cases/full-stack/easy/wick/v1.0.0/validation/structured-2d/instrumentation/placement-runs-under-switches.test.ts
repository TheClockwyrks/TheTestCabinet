// Wick — instrumentation/placement-runs-under-switches: with both `weaponFire`
// and `effectMotion` off, holding Halo still creates its aura on the next
// `playing` tick, and the aura follows a posed lamplighter position on the
// tick after.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Placement is gated by neither `weaponFire` nor `effectMotion`: on every
// `playing` tick, whatever the two hold, the placement part of phase 5 of
// `specs/world.md` runs, so an aura ... is created, removed, re-centered".
// `specs/weapons.md`, Halo: "one zone of kind `aura`, a circle of `radius`
// centered on the player's center every tick".
//
// THE DRIVE. An isolated run (every switch off), Halo placed, one tick: one
// aura at (0, 0). The lamplighter posed to (300, -120), one tick: the aura
// at (300, -120). Exact: the center is the lamplighter's position.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

const POSED_X = 300;
const POSED_Y = -120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates and re-centers the aura with both switches off", async () => {
  const posed = isolate(h);
  assertEqual(posed.weaponFire, false, "weaponFire during the drive");
  assertEqual(posed.effectMotion, false, "effectMotion during the drive");
  holdWeapon(h, "halo");

  const created = await advanceTicks(h, 1);
  const auras = zonesOfKind(created, "aura");
  assertLength(auras, 1, "auras after the first tick Halo is held");
  assertEqual(auras[0].weapon, "halo", "the aura's weapon");
  assertEqual(auras[0].x, 0, "the aura's x on creation");
  assertEqual(auras[0].y, 0, "the aura's y on creation");

  h.debug.setPlayerPosition(POSED_X, POSED_Y);
  const followed = await advanceTicks(h, 1);
  captureStill(h, "placed");
  const [aura] = zonesOfKind(followed, "aura");
  assertEqual(aura?.x, POSED_X, "the aura's x after the lamplighter was posed");
  assertEqual(aura?.y, POSED_Y, "the aura's y after the lamplighter was posed");
});
