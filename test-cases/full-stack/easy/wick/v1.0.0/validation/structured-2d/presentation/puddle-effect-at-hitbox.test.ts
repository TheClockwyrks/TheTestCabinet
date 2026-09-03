// presentation/puddle-effect-at-hitbox — Oil Splash's puddle sprite is painted
// over the puddle's circle, for exactly as long as the puddle is in the world.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// puddle is one produced sprite at `assets/sprites/effects/oil-splash.png`,
// drawn over "the puddle's circle, for its life", and each effect is "scaled in
// code to the live shape ... so the effect's drawn extent is the hitbox's
// extent on every tick it is drawn". `specs/weapons.md`, Oil Splash: "A puddle
// is a circle of `radius` that stays where it landed for `duration` seconds and
// then vanishes", and `specs/state.md` reports that circle's centre and radius
// on the zone, so its extent across is twice its radius.
//
// The trace reads the puddle's own centre and radius off the snapshot on every
// tick; the frame that tick drew must carry `oil-splash.png` there, at that
// extent, on the pulse ticks as on every other — `specs/assets.md` allows "a
// puddle's" picture to differ on the tick it pulses, and whatever a build adds
// for that, the puddle's own sprite is still owed the hitbox's extent "on every
// tick it is drawn". The bound is `EXTENT_TOL` (4 units) on the extent and
// `SPRITE_TOL` (2 units) on the centre.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with one puddle POSED
// through `spawnPuddle`, which `specs/instrumentation.md` gives the figures its
// weapon would: no firing, so no second puddle lands at a random point and
// nothing else can be mistaken for this one. No enemy stands anywhere, so its
// pulses damage nothing, and the only thing that ends it is its own `ttl`, the
// level-1 `duration` of `2.5` seconds.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureReplay,
  createHarness,
  isolate,
  placePuddle,
  zoneById,
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

/** Where the puddle is posed: clear of the lamplighter and inside the view. */
const AT = { x: 260, y: 120 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws oil-splash.png over the puddle's circle for its whole life", async () => {
  isolate(h);
  const id = placePuddle(h, "oil-splash", AT.x, AT.y);

  const locate = (snapshot: WickSnapshot): Shape | null => {
    const puddle = zoneById(snapshot, id);
    return puddle === undefined ? null : circleShape(puddle);
  };

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, locate, { maxTicks: 200 }),
  );

  assertDrawnOverShape(
    h,
    trace,
    effectFiles("oil-splash"),
    "Oil Splash puddle",
  );
});
