// instrumentation/placement-runs-under-switches — with both weaponFire and
// effectMotion off, holding Halo still creates its aura on the next playing
// tick and the aura follows a posed lamplighter position on the tick after.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches": "Placement is gated by neither `weaponFire` nor `effectMotion`:
// on every `playing` tick, whatever the two hold, the placement part of phase
// 5 of `specs/world.md` runs, so an aura or a lantern set is created,
// removed, re-centered, and resized exactly as that phase states".
// specs/world.md, phase 5, "The placement, on every `playing` tick: an aura
// ... is created on a tick its weapon is held and none exists ... the aura's
// center ... placed about the lamplighter's position of this tick".
//
// THE POSE. An isolated run (every switch off), Halo held, one tick: one aura
// at the lamplighter's center. Then the lamplighter posed elsewhere and one
// tick: the aura at the new center.

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

afterEach(() => {
  h?.dispose();
});

it("places and re-centers the aura with both switches off", async () => {
  const posed = isolate(h);
  assertEqual(posed.weaponFire, false, "weaponFire off");
  assertEqual(posed.effectMotion, false, "effectMotion off");
  holdWeapon(h, "halo", 1);

  const placed = await h.tick(1);
  const auras = zonesOfKind(placed, "aura");
  assertLength(auras, 1, "the aura placed on the first tick Halo is held");
  assertEqual(
    auras[0].x,
    placed.run.player.x,
    "the aura's x at the lamplighter",
  );
  assertEqual(
    auras[0].y,
    placed.run.player.y,
    "the aura's y at the lamplighter",
  );

  h.debug.setPlayerPosition(MOVED_TO.x, MOVED_TO.y);
  const followed = await h.tick(1);
  captureStill(h, "placed");
  const moved = zonesOfKind(followed, "aura");
  assertLength(moved, 1, "the aura after the lamplighter moved");
  assertEqual(moved[0].x, MOVED_TO.x, "the aura's x, re-centered");
  assertEqual(moved[0].y, MOVED_TO.y, "the aura's y, re-centered");
});
