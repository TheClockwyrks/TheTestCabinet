// presentation/aura-effect-at-hitbox — the aura ring is drawn over the aura's
// circle on every tick it exists, and nowhere after it is gone.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"): "aura
// ring | Halo | assets/sprites/effects/halo.png | one sprite, a ring |
// 160 x 160 | the aura's circle, always", and "Each is produced on the canvas
// its row states and scaled in code to the live shape, which areaMul and later
// levels grow, so the effect's drawn extent is the hitbox's extent on every
// tick it is drawn." specs/weapons.md ("Halo") fixes the shape and its life:
// "Halo is a permanent aura: one zone of kind aura, a circle of radius centered
// on the player's center every tick. The zone is created on the first playing
// tick Halo is held and none exists, it is removed on the next playing tick
// Halo is no longer held". specs/state.md fixes what the snapshot reports of
// it: its center, and "radius: the circle's radius after the area multiplier".
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// other weapon held, and every driver switch off, `weaponFire` included, so the
// aura never pulses and nothing else is drawn over it. Halo alone is held at
// level 1, and the placement part of phase 5 creates the aura on the next
// playing tick whatever the switches hold, which specs/instrumentation.md
// states: "Placement is gated by neither weaponFire nor effectMotion".
//
// WHAT IS READ. On each of WATCHED_TICKS ticks with Halo held, the blit of
// `halo.png` nearest the point the camera formula gives the aura's center: its
// center is that point and its box is the aura's own diameter. Then Halo is
// removed through the surface, one tick takes the aura with it, and the ticks
// after draw no `halo.png` at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A level-1 aura is 160 units
// across, so an effect drawn at any other scale misses by tens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HALO_LEVELS } from "../constants";
import {
  blitsOf,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  present,
  zonesOfKind,
  type Harness,
} from "../harness";
import { assertEffectOverShape, assertNoEffect } from "./drawn";
import { circleOf } from "./effects";

/** The level held, whose radius the aura's diameter is read against. */
const LEVEL = 1;

/** Ticks the aura is watched over, and ticks watched after it is gone. */
const WATCHED_TICKS = 12;
const WATCHED_AFTER = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the aura ring over the aura's circle, and none once Halo is gone", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  const slot = holdWeapon(h, "halo", LEVEL);

  await captureReplay(h, "effect", async () => {
    for (let tick = 1; tick <= WATCHED_TICKS; tick += 1) {
      const snapshot = await h.tick(1);
      const aura = present(
        zonesOfKind(snapshot, "aura")[0],
        `the aura the placement rule keeps while Halo is held, on tick ${tick}`,
      );
      assertEqual(
        aura.radius,
        HALO_LEVELS[LEVEL - 1].radius,
        `the aura's radius on tick ${tick}, at level ${LEVEL} with no Glass held`,
      );
      const live = circleOf(aura);
      assertEffectOverShape(
        h,
        blitsOf(h.lastCalls()),
        "halo",
        snapshot,
        live.x,
        live.y,
        live.width,
        live.height,
        `the Halo aura on tick ${tick}`,
      );
    }

    h.debug.removeWeapon(slot);
    const dropped = await h.tick(1);
    assertLength(
      zonesOfKind(dropped, "aura"),
      0,
      "the auras left on the tick after Halo was removed",
    );
    for (let after = 1; after <= WATCHED_AFTER; after += 1) {
      assertNoEffect(
        blitsOf(h.lastCalls()),
        "halo",
        `the Halo aura, ${after} tick${after === 1 ? "" : "s"} after it was gone`,
      );
      await h.frameDraw();
    }
  });
});
