// presentation/lantern-effect-at-hitbox — Lantern's sprite is painted over the
// lantern's circle, for exactly as long as the set is in the world.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// lantern is one produced sprite at `assets/sprites/effects/lantern.png`, drawn
// over "each lantern's circle, for its life", and each effect is "scaled in
// code to the live shape ... so the effect's drawn extent is the hitbox's
// extent on every tick it is drawn". `specs/weapons.md`, Lantern: "Each lantern
// is a circle of `radius`, and each is a zone with `ttl` set to `duration`",
// and `specs/state.md` reports that circle's centre and radius on the zone, so
// its extent across is twice its radius. The lantern rides its orbit about the
// lamplighter every tick, which is exactly why the trace re-reads its centre
// each tick rather than fixing one.
//
// The bound is `EXTENT_TOL` (4 units) on the extent and `SPRITE_TOL` (2 units)
// on the centre, the rounding a build that lands its destination rectangle on
// whole device pixels picks up. A lantern drawn at the produced canvas's fixed
// `28 x 28` whatever the radius, or left drawn on the orbit after the set is
// gone, sits outside.
//
// THE WORLD, AND WHY. An isolated world holding Lantern alone at level 1, whose
// row gives `amount` `1`, so exactly one lantern is in the world and no second
// shape can be mistaken for it. `armWeapon` puts the slot's timer at `0`, which
// `specs/instrumentation.md` makes the next tick its firing tick. The set's
// `duration` is `3.0` seconds (180 ticks) and, per `specs/weapons.md`, "On
// firing, Lantern's cooldown timer is set to `duration` plus the current
// cooldown", `6.0` seconds here, so no second set can fire inside the trace.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import {
  armWeapon,
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

/** The one live lantern, as its circle. */
function lantern(snapshot: WickSnapshot): Shape | null {
  const [zone] = zonesOfKind(snapshot, "lantern");
  return zone === undefined ? null : circleShape(zone);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws lantern.png over the lantern's circle for the whole of its life", async () => {
  isolate(h);
  const slot = holdWeapon(h, "lantern", 1);
  assertNull(lantern(h.snapshot()), "a lantern before the weapon has fired");
  armWeapon(h, slot);

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, lantern, { maxTicks: 260 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("lantern"), "Lantern lantern");
});
