// rocks/radius-large — a Large collides as a circle of radius 46.
//
// `specs/rocks.md` fixes the figure in its size table — `ROCK_RADIUS.large` is
// `46` — and `specs/collision.md` says what a radius means: "Whatever a body is
// drawn as, it collides as a circle of the radius below, centred on its position",
// and "Two bodies touch when the shortest wrapped separation between their centres
// is at most the sum of their radii". A bullet is `BULLET_R` (`3`), so the two touch
// at `49` units between centres and at nothing wider.
//
// THE PAIR IS THE REQUIREMENT, AND ONE SHOT ALONE WOULD NOT BE. A build colliding at
// any radius at all destroys a rock a round is sent through the middle of, and a
// build that collides at nothing destroys none — so the item is decided by rounds
// sent past two rocks at the two distances the review item names, `44` units and
// `50`, which straddle `49`. The inside rounds must destroy their rock and the
// outside rounds must leave the other one standing.
//
// WHERE THE TWO ROCKS STAND, AND WHY THE WELL CANNOT MOVE THE READING. Each stands
// on the star's own row, one `480` units to its left and one `480` to its right, and
// each round is laid ALONG that row. `specs/gravity.md` pulls both the rock and the
// round toward the star's centre, so at this placement the pull on the rock is
// exactly along the round's travel and across nothing the check measures, and the
// difference between the pull on the round and the pull on the rock moves the miss
// distance by under a tenth of a unit over the eighth of a second the approach takes
// — against a margin of a full unit on the tighter of the two shots. Nothing else is
// on the field: `startPlaying` empties every roster and shuts both world gates, and
// the two rocks are `960` units apart, which no round outlives its `BULLET_LIFE`
// long enough to cross.
//
// AS MANY ROUNDS AS THE ROCK CAN TAKE, so one script serves both checklists. Under
// `base` a bullet that touches a rock destroys it and the first round settles the
// question; under `warhead` a rock carries health and only the last of its hits
// destroys it (`specs/rocks.md`). The same number is sent past each rock, so the two
// halves stay a fair comparison, and each run stops the moment its rock is gone.
//
// AND THE OUTSIDE ROUND IS PROVED TO HAVE GONE BY. A round that was never placed, or
// that expired before it arrived, would leave its rock standing for a reason that has
// nothing to do with the radius, so the check reads the last one back: it is still in
// flight and it has carried past the column its rock stands in.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R, ROCK_RADIUS } from "../constants";
import { assertGreaterThan, assertUndefined } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  HIT_SPOT,
  MISS_SPOT,
  MOST_HITS,
  findRock,
  grazePast,
  travelPast,
} from "./scene";

/** The separation two centres touch at: the sum of the two radii, `specs/collision.md`. */
const TOUCHING = ROCK_RADIUS.large + BULLET_R;

/** The miss distance of the rounds that must land, in units: the review item's figure. */
const INSIDE = 44;

/** The miss distance of the rounds that must not, in units: the review item's figure. */
const OUTSIDE = 50;

/**
 * How many rounds are sent past each rock: {@link MOST_HITS}.
 *
 * The most hits any rock carries under `warhead` (`specs/rocks.md`). Under `base`,
 * and under `warhead` for a size carrying fewer, the inside run stops as soon as
 * its rock is gone, so the extra rounds are never fired at it. It is a ceiling on
 * the rounds sent, not an assertion about armor — `armor/health-large-3` owns that.
 */
const ROUNDS = MOST_HITS;

/**
 * How long each round is followed, in ticks.
 *
 * Each starts `GRAZE_RUN_IN` (`60`) units short of its rock and closes at
 * `MUZZLE_SPEED` (`520`), so this carries it over a hundred units past the column
 * its rock stands in — long enough that a build resolving the shot a tick late
 * still resolves it, and under a quarter of the `BULLET_LIFE` (`1.5` seconds)
 * `specs/instrumentation.md` gives a placed round, so a round that struck nothing
 * is still in flight to be read.
 */
const FOLLOW_TICKS = ticksFor(0.35);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a Large rounds pass 44 units from and spares one they pass 50 from", async () => {
  startPlaying(h);
  const hitRock = poseRock(h, "large", HIT_SPOT.x, HIT_SPOT.y);
  const missRock = poseRock(h, "large", MISS_SPOT.x, MISS_SPOT.y);

  const inside = await grazePast(h, hitRock, INSIDE, ROUNDS, FOLLOW_TICKS);
  const outside = await grazePast(h, missRock, OUTSIDE, ROUNDS, FOLLOW_TICKS);
  captureStill(h, "radius");

  // Inside `TOUCHING`: the rock is destroyed.
  assertUndefined(
    findRock(outside.snapshot, hitRock),
    `a Large destroyed by ${inside.rounds} round(s) passing ${INSIDE} units from its centre, inside the ${TOUCHING} its radius and a bullet's sum to (specs/collision.md)`,
  );

  // Outside it: the rock stands, whatever was sent past it.
  const spared = rockById(
    outside.snapshot,
    missRock,
    `a Large spared by ${outside.rounds} round(s) passing ${OUTSIDE} units from its centre, outside the ${TOUCHING} its radius and a bullet's sum to (specs/collision.md)`,
  );

  // And the round that spared it really did go by.
  const passing = bulletById(
    outside.snapshot,
    outside.bullet,
    `the last round sent ${OUTSIDE} units past a Large still in flight, having struck nothing (specs/collision.md)`,
  );
  assertGreaterThan(
    travelPast(passing, spared, MISS_SPOT),
    0,
    "units the sparing round has travelled beyond the column its rock stands in",
  );
});
