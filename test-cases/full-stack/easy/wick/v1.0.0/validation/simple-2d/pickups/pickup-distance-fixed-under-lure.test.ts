// pickups/pickup-distance-fixed-under-lure — Lure widens gem attraction and not
// pickup collection.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Collection"): "A pickup is
// collected on any tick on which the distance between its center and the
// lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS`, the same distance at every Lure level." `PLAYER_RADIUS` is
// 12, so the distance is `CONTACT` (28) whatever `pickupRadius` reads.
// specs/passives.md gives Lure `pickupMul = 1 + LURE_PICKUP_PER_LEVEL × lure`
// with `LURE_PICKUP_PER_LEVEL` 0.25, so Lure 5, its maximum, takes
// `pickupRadius` to 48 × 2.25 = 108. A bread `POSED` (30) units out is 2 units
// past the collection distance and 78 units inside the widened attraction
// radius, so a build that collects pickups at `pickupRadius` takes it and a
// build reading the stated distance leaves it lying.
//
// THE WORLD. An isolated `playing` run holding Lure alone at level 5, with
// nothing alive, nothing else on the ground, no weapon held and every driver
// switch off, so nothing moves the lamplighter or the bread and nothing else
// can remove it. `pickupRadius` is read off the snapshot before the span, so a
// build that does not widen the radius at all fails on the pose rather than
// passing this point for the wrong reason. The bread lies along `+x` alone, so
// its distance is a whole number rather than a hypotenuse, and it is left for
// `SPAN` (60) ticks, a full second, over which the collection condition is
// tested sixty times.
//
// WHAT IS READ. After 60 ticks: the bread still on the field at the point it
// was placed.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on `pickupRadius`, a product of two
// stated figures; `MOTION_TOLERANCE` (1e-6) on the bread's coordinates; none on
// the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  PICKUP_ITEM_RADIUS,
  PLAYER_RADIUS,
  pickupRadiusFor,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";
import { pickupOf } from "./night";

/** The passives held: Lure at its maximum level. */
const HELD: HeldPassives = { lure: 5 };

/** 48 × (1 + 0.25 × 5) = 108, the attraction radius Lure 5 gives. */
const WIDENED = pickupRadiusFor(HELD);

/** PICKUP_ITEM_RADIUS (16) + PLAYER_RADIUS (12): the collection distance. */
const CONTACT = PICKUP_ITEM_RADIUS + PLAYER_RADIUS;

/** Where the bread lies: past the collection distance, deep inside the radius. */
const POSED = 30;

/** How long it lies there, in ticks: one second of game time. */
const SPAN = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a bread 30 units out uncollected for 60 ticks with Lure 5 held", async () => {
  const posed = isolate(h);
  holdPassive(h, "lure", HELD.lure ?? 0);
  assertWithin(
    h.snapshot().run.pickupRadius,
    WIDENED,
    FIGURE_TOLERANCE,
    "pickupRadius with Lure 5 held",
  );
  const { player } = posed.run;
  const at = { x: player.x + POSED, y: player.y };
  const pickup = spawnPickupAt(h, "bread", at.x, at.y);

  const after = await h.tick(SPAN);
  captureStill(h, "lure");

  assertLength(
    after.run.pickups,
    1,
    `pickups left after ${SPAN} ticks with the bread ${POSED} units out, past ${CONTACT}`,
  );
  const seen = pickupOf(after, pickup);
  assertWithin(
    seen.x,
    at.x,
    MOTION_TOLERANCE,
    `the bread's x after ${SPAN} ticks`,
  );
  assertWithin(
    seen.y,
    at.y,
    MOTION_TOLERANCE,
    `the bread's y after ${SPAN} ticks`,
  );
});
