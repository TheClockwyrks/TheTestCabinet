// presentation/dart-effect-at-hitbox — Pin's dart sprite is painted over the
// dart's circle, for exactly as long as the dart is in the world.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// dart is one produced sprite at `assets/sprites/effects/pin.png`, drawn over
// "the dart's circle, for its life", and each effect is "scaled in code to the
// live shape ... so the effect's drawn extent is the hitbox's extent on every
// tick it is drawn". `specs/weapons.md`, Pin: "A dart is a circle of `radius`",
// and `specs/state.md` reports that circle's centre and radius on the
// projectile, so its extent across is twice its radius.
//
// The trace reads the dart's own centre and radius off the snapshot on every
// tick; the frame that tick drew must carry `pin.png` there, at that extent.
// The bound is `EXTENT_TOL` (4 units) on the extent and `SPRITE_TOL` (2 units)
// on the centre, the rounding a build that lands its destination rectangle on
// whole device pixels picks up. A dart drawn at the produced canvas's fixed
// `12 x 12` whatever the radius, or drawn on after the dart expires, sits
// outside.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with one dart POSED
// through `spawnProjectile`, which `specs/instrumentation.md` gives "its
// figures the ones the weapon would give a projectile fired on this tick", so
// no firing and no second dart can arrive. Its velocity is zero and
// `effectMotion` is off, so it holds one place for its whole life and the only
// thing that ends it is its own `ttl`, the level-1 `duration` of `1.5` seconds.

import { afterEach, beforeEach, it } from "vitest";
import { PIN_LEVELS } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  placeProjectile,
  projectileById,
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

/** Where the dart is posed: clear of the lamplighter and inside the view. */
const AT = { x: -260, y: 150 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws pin.png over the dart's circle for the whole of its life", async () => {
  isolate(h);
  const id = placeProjectile(h, "pin", AT.x, AT.y, 0, 0, PIN_LEVELS[0].pierce);

  const locate = (snapshot: WickSnapshot): Shape | null => {
    const dart = projectileById(snapshot, id);
    return dart === undefined ? null : circleShape(dart);
  };

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, locate, { maxTicks: 160 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("pin"), "Pin dart");
});
