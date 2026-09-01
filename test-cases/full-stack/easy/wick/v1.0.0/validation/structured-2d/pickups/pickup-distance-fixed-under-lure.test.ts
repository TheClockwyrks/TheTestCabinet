// pickups/pickup-distance-fixed-under-lure — Lure does not widen pickup
// collection.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Collection"): "A pickup is
// collected on any tick on which the distance between its center and the
// lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS`, the same distance at every Lure level" — `28` units,
// whatever Lure is held. Lure acts on gems alone: "a gem whose center is at
// most `pickupRadius` ... becomes attracted", with `pickupRadius`
// "`PICKUP_RADIUS` times the pickup multiplier `specs/passives.md` defines". At
// Lure `5` that multiplier is `1 + LURE_PICKUP_PER_LEVEL` (`0.25`) `× 5`, so
// `pickupRadius` is `108` units, and a bread posed `POSED_DISTANCE` (`30`)
// units out lies well inside the widened gem radius and outside the fixed
// collection distance. A build that collects pickups at `pickupRadius` takes it
// on the first tick; the specification leaves it lying there for the whole
// span.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with Lure held at
// `PASSIVES.lure.maxLevel` (`5`), the widest the passive goes, and nothing else
// in the loadout, so the pickup radius is the only thing the pose changed. The
// run's own `pickupRadius` is read first: without it, a build that ignored Lure
// entirely would pass this check for the wrong reason, so the widened radius is
// a precondition the check asserts rather than assumes. Every driver switch is
// off, nothing is alive, nothing else is dropped, and no key is pressed, so the
// distance the rule tests stays the posed one for the whole span. `HELD_TICKS`
// (`60`) is one second of game time.
//
// THE TOLERANCE. `REAL_EPS` on the derived `pickupRadius`, a product of exact
// figures; `MOTION_EPS` (`1e-6`) on where the pickup stayed. Its presence is
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertGreaterThan, assertNear } from "../assert";
import {
  MOTION_EPS,
  PASSIVES,
  PICKUP_ITEM_RADIUS,
  PLAYER_RADIUS,
  REAL_EPS,
  TICK_HZ,
  pickupRadiusOf,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  pickupById,
  placePickup,
  type Harness,
} from "../harness";

/** The Lure level posed: the passive's maximum, the widest gem radius it gives. */
const LURE_LEVEL = PASSIVES.lure.maxLevel;

/** Beyond `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`), well inside the Lure-widened gem radius. */
const POSED_DISTANCE = 30;

/** One second of game time. */
const HELD_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a bread 30 units out uncollected across 60 ticks with Lure 5 held", async () => {
  isolate(h);
  holdPassive(h, "lure", LURE_LEVEL);
  const opened = h.snapshot();
  const widened = pickupRadiusOf(LURE_LEVEL);
  assertNear(
    opened.run.pickupRadius,
    widened,
    REAL_EPS,
    `the pickup radius Lure ${LURE_LEVEL} gives (specs/instrumentation.md, Snapshot shape)`,
  );
  assertGreaterThan(
    widened,
    POSED_DISTANCE,
    "the widened gem radius, which must reach past where the bread is posed, in units",
  );
  assertGreaterThan(
    POSED_DISTANCE,
    PICKUP_ITEM_RADIUS + PLAYER_RADIUS,
    "the posed distance, which must lie outside the fixed collection distance, in units",
  );
  const at = opened.run.player;
  const id = placePickup(h, "bread", at.x + POSED_DISTANCE, at.y);
  const posed = pickupById(h.snapshot(), id);
  assertDefined(posed, "the bread spawnPickup placed");

  const after = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "lure");

  const seen = pickupById(after, id);
  assertDefined(
    seen,
    "the bread after the second (specs/world.md, Collection: the same distance at every Lure level)",
  );
  assertNear(
    seen?.x ?? NaN,
    posed?.x ?? NaN,
    MOTION_EPS,
    "the bread's x after the second, in units",
  );
  assertNear(
    seen?.y ?? NaN,
    posed?.y ?? NaN,
    MOTION_EPS,
    "the bread's y after the second, in units",
  );
});
