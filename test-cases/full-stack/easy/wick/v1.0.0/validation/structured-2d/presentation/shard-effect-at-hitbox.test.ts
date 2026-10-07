// presentation/shard-effect-at-hitbox — Shard's sprite is painted over the
// shard's circle, for exactly as long as the shard is in the world.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// shard is one produced sprite at `assets/sprites/effects/shard.png`, drawn
// over "the shard's circle, for its life", and each effect is "scaled in code
// to the live shape ... so the effect's drawn extent is the hitbox's extent on
// every tick it is drawn". `specs/weapons.md`, Shard: "A shard is a circle of
// `radius` ... its pierce is `INFINITE_PIERCE`", and `specs/state.md` reports
// that circle's centre and radius, so its extent across is twice its radius.
//
// The trace reads the shard's own centre and radius off the snapshot on every
// tick; the frame that tick drew must carry `shard.png` there, at that extent.
// The bound is `EXTENT_TOL` (4 units) on the extent and `SPRITE_TOL` (2 units)
// on the centre, the rounding a build that lands its destination rectangle on
// whole device pixels picks up.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with one shard POSED
// through `spawnProjectile` at the pierce `specs/weapons.md` gives one. Its
// velocity is zero and `effectMotion` is off, so the bouncing clamp of
// `specs/weapons.md` never runs and the shard holds one place for its whole
// life; the only thing that ends it is its own `ttl`, the level-1 `duration`
// of `3.0` seconds.

import { afterEach, beforeEach, it } from "vitest";
import { INFINITE_PIERCE } from "../constants";
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

/** Where the shard is posed: clear of the lamplighter and inside the view. */
const AT = { x: 300, y: 180 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws shard.png over the shard's circle for the whole of its life", async () => {
  isolate(h);
  const id = placeProjectile(h, "shard", AT.x, AT.y, 0, 0, INFINITE_PIERCE);

  const locate = (snapshot: WickSnapshot): Shape | null => {
    const shard = projectileById(snapshot, id);
    return shard === undefined ? null : circleShape(shard);
  };

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, locate, { maxTicks: 240 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("shard"), "Shard");
});
