// passives/lure-attracts-on-first-tick-inside — the attraction radius is read
// every tick, so a gem left lying outside it is attracted on the first tick a
// Lure level brings it inside.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Pickup radius"): "The
// radius within which a gem becomes attracted is PICKUP_RADIUS (48) times
// `pickupMul` ... The attraction rule in `specs/world.md` reads this radius on
// every tick, so a gem that was outside the base radius is picked up on the
// first tick Lure brings it inside", with
// pickupMul = 1 + LURE_PICKUP_PER_LEVEL × lure and LURE_PICKUP_PER_LEVEL 0.25.
// A gem 55 units out is outside the base 48 and inside the 48 × 1.25 = 60 that
// Lure 1 gives. specs/world.md ("Attraction and flight"): "On every tick, a gem
// whose center is at most `pickupRadius` from the lamplighter's center becomes
// attracted".
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held, no
// passive held at first, every driver switch off, and one small gem 55 units
// along +x. The lamplighter never moves, so the 55 units are the distance on
// every tick of the check and the only thing that changes is the Lure level.
//
// WHAT IS READ. The gem's `attracted` after ten ticks with no Lure held, false,
// and after the single tick that follows placing Lure at level 1, true. Both
// are read: the first is what makes the second a change rather than a state the
// gem was already in.
//
// TOLERANCE. None: `attracted` is a boolean, and 55 sits 5 units inside the
// widened radius and 7 outside the base one, far past any rounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  pickupRadiusFor,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { gemOf } from "./night";

/** The Lure level placed once the gem has been left lying. */
const HELD: HeldPassives = { lure: 1 };

/** 48 × (1 + 0.25 × 1) = 60. */
const WIDENED = pickupRadiusFor(HELD);

/** Where the gem lies: outside the base 48 and inside the widened 60. */
const DISTANCE = 55;

/** How long the gem is left lying before Lure arrives, in ticks. */
const WAIT = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a gem 55 units out unattracted, then attracts it the tick Lure 1 arrives", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Lure");
  const { player } = posed.run;
  const gem = spawnGemAt(h, "small", player.x + DISTANCE, player.y);

  const waited = await h.tick(WAIT);
  assertEqual(
    gemOf(waited, gem).attracted,
    false,
    `whether the gem ${DISTANCE} units out was attracted with no Lure held`,
  );

  holdPassive(h, "lure", HELD.lure ?? 0);
  assertWithin(
    h.snapshot().run.pickupRadius,
    WIDENED,
    FIGURE_TOLERANCE,
    "pickupRadius with Lure 1 held",
  );

  const after = await h.tick(1);
  captureStill(h, "inside");

  assertEqual(
    gemOf(after, gem).attracted,
    true,
    "whether the gem was attracted on the first tick after Lure 1 was placed",
  );
});
