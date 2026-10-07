// presentation/aura-effect-at-hitbox — Halo's ring sprite is painted over the
// aura's circle on every tick the aura is in the world, and on none after.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// aura ring is one produced sprite at `assets/sprites/effects/halo.png`, drawn
// over "the aura's circle, always", and each effect is "scaled in code to the
// live shape ... so the effect's drawn extent is the hitbox's extent on every
// tick it is drawn". `specs/weapons.md`, Halo: "one zone of kind `aura`, a
// circle of `radius` centered on the player's center every tick", whose
// "`radius` and `damage` are recomputed on every tick"; `specs/state.md`
// reports that circle's centre and radius, so its extent across is twice its
// radius. The trace re-reads both each tick rather than fixing them.
//
// The bound is `EXTENT_TOL` (4 units) on the extent and `SPRITE_TOL` (2 units)
// on the centre, the rounding a build that lands its destination rectangle on
// whole device pixels picks up. A ring drawn at the produced canvas's fixed
// `160 x 160` whatever the radius, or drawn on the lamplighter after Halo is
// dropped, sits outside. `specs/assets.md` allows the aura's picture to differ
// on the tick it pulses; whatever a build adds for that, the ring itself is
// still owed the hitbox's extent "on every tick it is drawn".
//
// HOW THE SHAPE ENDS. An aura carries `ttl` `null` and "never expires"
// (`specs/state.md`), so the only thing that ends it is dropping the weapon:
// `specs/weapons.md` has the zone "removed on the next `playing` tick Halo is
// no longer held". The trace therefore drops Halo out of its slot part way
// through, and every tick after that must draw no ring at all.
//
// THE WORLD, AND WHY. An isolated world holding Halo alone at level 1, so
// exactly one zone exists and no `areaMul` moves its radius off the level-1
// row. `weaponFire` is left off: `specs/instrumentation.md` states that
// "Placement is gated by neither `weaponFire` nor `effectMotion`", so the aura
// is created, re-centred, and resized regardless, and nothing else fires.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  assertDrawnOverShape,
  circleShape,
  traceEffect,
  type Shape,
} from "./effects";
import { effectFiles } from "./sprites";

/** How many ticks the aura is watched before Halo is taken out of its slot. */
const HELD_TICKS = 8;

/** The one live aura, as its circle. */
function aura(snapshot: WickSnapshot): Shape | null {
  const [zone] = zonesOfKind(snapshot, "aura");
  return zone === undefined ? null : circleShape(zone);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws halo.png over the aura's circle every tick it exists", async () => {
  isolate(h);
  const slot = holdWeapon(h, "halo", 1);

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, aura, {
      maxTicks: 40,
      act: (tick) => {
        if (tick === HELD_TICKS) h.debug.removeWeapon(slot);
      },
    }),
  );

  assertDrawnOverShape(h, trace, effectFiles("halo"), "Halo aura");
});
