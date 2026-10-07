// pickups/gem-attracted-inside — a gem inside pickupRadius becomes attracted.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "On
// every tick, a gem whose center is at most `pickupRadius` from the
// lamplighter's center becomes attracted", with "`pickupRadius` is
// `PICKUP_RADIUS` times the pickup multiplier `specs/passives.md` defines, so
// it is `PICKUP_RADIUS` with no Lure held", and specs/world.md ("The
// lamplighter") tables `PICKUP_RADIUS` at 48. A gem `INSIDE` (40) units out is
// 8 units inside that radius, so the first tick after it is placed attracts it.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off. No Lure is
// held, so `pickupRadius` is the base 48 and the reading is against the stated
// figure; no draft can be collected, so the flag this reads is the radius rule's
// own; and the lamplighter never moves, so 40 units is the distance on the tick
// that decides. The gem is placed unattracted, which `spawnGem` guarantees
// ("Places one unattracted gem of `tier`", specs/instrumentation.md), so the
// flag read afterwards is a change the tick made.
//
// WHAT IS READ. The gem's `attracted` before the tick, false, and after it,
// true. Both are read: the first is what makes the second a change rather than
// a state the gem was posed into.
//
// TOLERANCE. None: `attracted` is a boolean, and 40 sits 8 units inside the
// radius, far past any rounding a distance carries.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, PICKUP_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { gemOf } from "./night";

/** Where the gem lies: 8 units inside PICKUP_RADIUS (48). */
const INSIDE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("attracts a gem 40 units out on the next tick with no Lure held", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Lure");
  assertWithin(
    posed.run.pickupRadius,
    PICKUP_RADIUS,
    FIGURE_TOLERANCE,
    "pickupRadius with no Lure held",
  );
  const { player } = posed.run;
  const gem = spawnGemAt(h, "small", player.x + INSIDE, player.y);
  assertEqual(
    gemOf(h.snapshot(), gem).attracted,
    false,
    "the posed gem's attracted flag before any tick",
  );

  const after = await h.tick(1);
  captureStill(h, "attracted");

  assertEqual(
    gemOf(after, gem).attracted,
    true,
    `the attracted flag of a gem ${INSIDE} units out, inside ${PICKUP_RADIUS}`,
  );
});
