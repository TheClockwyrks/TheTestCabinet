// presentation/sconce-effect-at-hitbox — Sconce's sheet is painted over the
// sconce's circle, for exactly as long as the sconce is in the world.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// sconce is "a sheet of `4`, spinning" under
// `assets/sprites/effects/sconce/0.png` to `3.png`, drawn over "the sconce's
// circle, for its life", and each effect is "scaled in code to the live shape
// ... so the effect's drawn extent is the hitbox's extent on every tick it is
// drawn". `specs/weapons.md`, Sconce: "A sconce is a circle of `radius`", and
// `specs/state.md` reports that circle's centre and radius, so its extent
// across is twice its radius. WHICH frame of the sheet is up is the spin item's
// question; this one asks only that SOME frame of the sconce's own sheet is
// there, at the shape.
//
// The trace reads the sconce's own centre and radius off the snapshot on every
// tick. The bound is `EXTENT_TOL` (4 units) on the extent and `SPRITE_TOL`
// (2 units) on the centre, the rounding a build that lands its destination
// rectangle on whole device pixels picks up.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with one sconce POSED
// through `spawnProjectile` at the pierce `specs/weapons.md` gives one. Its
// velocity is the level-1 row's `speed` along `+x`, because
// `specs/instrumentation.md` makes "a zero velocity ... invalid for `sconce`";
// `effectMotion` is off, so the deceleration of `specs/weapons.md` never runs
// and the sconce holds one place for its whole life. The only thing that ends
// it is its own `ttl`, the level-1 `duration` of `2.5` seconds.

import { afterEach, beforeEach, it } from "vitest";
import { INFINITE_PIERCE, SCONCE_LEVELS } from "../constants";
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

/** Where the sconce is posed: clear of the lamplighter and inside the view. */
const AT = { x: -300, y: -180 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a sconce sheet frame over the sconce's circle for its whole life", async () => {
  isolate(h);
  const id = placeProjectile(
    h,
    "sconce",
    AT.x,
    AT.y,
    SCONCE_LEVELS[0].speed,
    0,
    INFINITE_PIERCE,
  );

  const locate = (snapshot: WickSnapshot): Shape | null => {
    const sconce = projectileById(snapshot, id);
    return sconce === undefined ? null : circleShape(sconce);
  };

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, locate, { maxTicks: 200 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("sconce"), "Sconce");
});
