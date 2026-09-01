// pickups/gem-unattracted-outside — a gem beyond pickupRadius is not attracted
// and does not move.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "a
// gem whose center is at most `pickupRadius` from the lamplighter's center
// becomes attracted", and ("Gems") "A gem sits where it was dropped until it is
// attracted, and it stays on the field until it is collected". `pickupRadius`
// is `PICKUP_RADIUS` (48) with no Lure held, so a gem `OUTSIDE` (49) units out
// is past the radius by one unit: it stays unattracted and holds the point it
// was placed at, for as long as nothing brings it inside.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so no Lure
// widens the radius, no draft attracts the gem, and nothing on the field can
// move it. The lamplighter never moves, so 49 units is the distance on every
// one of the `SPAN` (60) ticks, and each of those ticks re-applies the radius
// rule to the same distance.
//
// WHAT IS READ. The gem's `attracted` and its position after 60 ticks, against
// the point it was placed at. 60 ticks is a full second of game time, long
// enough that a build attracting on a strict `>=` comparison, or drifting the
// gem a fraction of a step a tick, is caught.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each coordinate, the case's allowance
// for a position carried across ticks; none on `attracted`, a boolean. One
// unattracted flight step is 10 units, seven orders above that allowance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { MOTION_TOLERANCE, PICKUP_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { gemOf } from "./night";

/** Where the gem lies: one unit past PICKUP_RADIUS (48). */
const OUTSIDE = 49;

/** How long the gem is left lying, in ticks: one second of game time. */
const SPAN = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a gem 49 units out unattracted and still for 60 ticks", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Lure");
  const { player } = posed.run;
  const at = { x: player.x + OUTSIDE, y: player.y };
  const gem = spawnGemAt(h, "small", at.x, at.y);

  const after = await h.tick(SPAN);
  captureStill(h, "outside");

  const seen = gemOf(after, gem);
  assertEqual(
    seen.attracted,
    false,
    `the attracted flag of a gem ${OUTSIDE} units out, past ${PICKUP_RADIUS}`,
  );
  assertWithin(
    seen.x,
    at.x,
    MOTION_TOLERANCE,
    `the gem's x after ${SPAN} ticks`,
  );
  assertWithin(
    seen.y,
    at.y,
    MOTION_TOLERANCE,
    `the gem's y after ${SPAN} ticks`,
  );
});
