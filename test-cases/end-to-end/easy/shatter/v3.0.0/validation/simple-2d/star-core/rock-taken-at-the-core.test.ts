// star-core/rock-taken-at-the-core — the core takes a rock that reaches it.
//
// `specs/collision.md` pairs a rock with the core: "The rock is recycled, as
// `specs/rocks.md` states. Nothing scores." `specs/field.md` says the same from
// the star's side — a rock that reaches the core is recycled — and
// `specs/rocks.md` spells the recycling out: the rock is TAKEN FROM THE CORE and
// immediately re-placed at a random point on one of the four edges.
//
// THIS ITEM DECIDES THE TAKING ALONE. That the field's rock count is unchanged,
// that the rock comes back the same size, that it re-enters from an edge heading
// inward at a fresh drift speed — each is a separate review item in `rocks`, and
// each fails on its own. What is decided here is the one thing every one of those
// items presumes: a rock whose circle reaches the core does not go on sitting
// there. A build with no rock-and-core rule at all sails its rock straight through
// the star and fails exactly here.
//
// THE SCENARIO. One Small rock, on an empty and quiet field, `160` units to the
// left of the star's centre and driven straight at it. It is the smallest rock, so
// its circle reaches the core at the smallest distance any rock does — `CORE_R +
// ROCK_RADIUS.small`, `44` units — which is the tightest reading of "at the core"
// the specification offers, and `specs/gravity.md`'s pull runs exactly along its
// course, so the approach is radial and it reaches the core rather than swinging
// past it.
//
// HOW THE CONTACT IS FOUND, AND WHY IT IS NOT A DISTANCE. `specs/simulation.md`
// resolves collision inside the tick, so a build that recycles the rock the moment
// its circle arrives never leaves it ON the core for any tick a sample could read:
// watching for a rock inside `44` would report that nothing had happened. The
// sweep therefore watches for either — a rock read AT the core, or the
// discontinuity a re-placement is, since `specs/rocks.md` puts the rock on an edge
// and the nearest point of any edge is `360` units from the star's centre, while a
// rock drifting through the well covers a few units in a tick. A roster that
// changed length counts as well: a build that removed the rock outright has taken
// it off the core, and it is `rocks/recycle-keeps-the-count` that grades whether it
// should have come back.
//
// THE VERDICT IS TAKEN ONE TICK LATER, which is the review item's own wording: a
// tick after its circle reached the core, no rock is at the core. A build that
// sails its rock through reads a rock inside `44` for the fifty-odd ticks it takes
// to cross, so the tick after the first such reading still holds one and the item
// fails naming what the core owed.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R, ROCK_RADIUS, STAR_X, STAR_Y } from "../../src/constants";
import { assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { distance, type Point } from "../geometry";
import type { ShatterSnapshot } from "../surface";
import { distanceFromStar } from "./strike";

/** How far from the star's centre the rock is posed, in units. */
const RANGE = 160;

/** Where that puts it: on the star's row, to its left. */
const START: Point = { x: STAR_X - RANGE, y: STAR_Y };

/**
 * How fast it is driven inward, in units per second.
 *
 * Inside the range `specs/rocks.md` gives a Small to drift at (`130` to `210`), so
 * the rock is doing nothing a rock does not do, and fast enough that the well —
 * which quickens it the whole way in — brings it to the core in well under a
 * second.
 */
const FALL_SPEED = 180;

/** How long the drive is given before the rock is expected to have arrived. */
const WINDOW_TICKS = ticksFor(2);

/**
 * A one-tick move further than this can only be a re-placement, in units.
 *
 * `specs/rocks.md` re-places a rock the star took at a random point on one of the
 * four edges. The nearest point of any edge is `360` units from the star's centre
 * and the rock is inside `44` when it is taken, so the shortest wrapped separation
 * between where it was and where it comes back is at least `316`. A rock still
 * drifting covers a couple of units in a tick even after a fall through the well,
 * so nothing but the re-placement clears this — and measuring the SHORTEST WRAPPED
 * separation (`specs/field.md`) is what keeps a rock crossing a seam from reading
 * as one.
 */
const REPLACEMENT_JUMP = 200;

/**
 * How far the nearest rock's circle is from the core's surface, in units.
 *
 * Negative or zero means a rock is AT the core: `specs/collision.md` has two
 * bodies touching when their centres are within the sum of their radii, which for
 * a rock and the core is `CORE_R + ROCK_RADIUS[size]`. The radius comes from
 * `specs/rocks.md`'s own table rather than from the `radius` the snapshot reports,
 * so a build that reports the wrong one fails `rocks/radius-small` and not this.
 * An empty roster answers `Infinity`: no rock at the core.
 */
function clearanceAtCore(snapshot: ShatterSnapshot): number {
  let least = Infinity;
  for (const rock of snapshot.rocks) {
    const gap = distanceFromStar(rock) - (CORE_R + ROCK_RADIUS[rock.size]);
    if (gap < least) least = gap;
  }
  return least;
}

/** Whether the rosters of two consecutive ticks cannot be the same rock drifting. */
function discontinuous(was: ShatterSnapshot, now: ShatterSnapshot): boolean {
  if (was.rocks.length !== now.rocks.length) return true;
  return was.rocks.some((rock, index) => {
    const then = now.rocks[index];
    return (
      then === undefined ||
      distance({ x: rock.x, y: rock.y }, { x: then.x, y: then.y }) >
        REPLACEMENT_JUMP
    );
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves no rock at the core the tick after one arrived there", async () => {
  startPlaying(h);
  poseRock(h, "small", START.x, START.y, FALL_SPEED, 0);

  let previous = h.snapshot();
  let arrived = -1;
  for (let tick = 1; tick <= WINDOW_TICKS; tick += 1) {
    await h.advance(1);
    const now = h.snapshot();
    if (discontinuous(previous, now) || clearanceAtCore(now) <= 0) {
      arrived = tick;
      break;
    }
    previous = now;
  }

  if (arrived < 0) {
    fail(
      `a Small driven at the core from ${RANGE} units out at ${FALL_SPEED} ` +
        "units per second reaching it (specs/collision.md: collision is swept " +
        "or continuous, and no body passes through another in a tick)",
      `${WINDOW_TICKS} ticks on it was still ` +
        `${clearanceAtCore(h.snapshot()).toFixed(1)} units clear of the ` +
        "core's surface, having moved no further than a drift in any tick",
    );
  }

  await h.advance(1);
  captureStill(h, "taken");

  assertGreaterThan(
    clearanceAtCore(h.snapshot()),
    0,
    "units between the nearest rock's circle and the core's surface, one " +
      "tick after a rock reached the core (specs/collision.md: a rock and " +
      "the core, the rock is recycled)",
  );
});
