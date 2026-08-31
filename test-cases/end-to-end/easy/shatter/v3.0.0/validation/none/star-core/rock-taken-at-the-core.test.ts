// star-core/rock-taken-at-the-core — the star does not let a rock sit in it, and
// does not let one through.
//
// THE RULE. `specs/collision.md`: "A rock and the core — The rock is recycled, as
// `specs/rocks.md` states." And `specs/rocks.md`: "When a rock's circle reaches the
// star's core, the rock is taken from the core and immediately re-placed" on an
// edge of the field. So the tick after a rock's circle reaches the core, there is
// no rock at the core.
//
// WHAT THIS ITEM DECIDES, AND WHAT IT LEAVES TO OTHERS. Only the taking. Where the
// rock comes back, which way it is then heading, how fast, at what size, and that
// the field's rock count is unchanged are five separate items in `rocks`, and none
// of them is read here — a check that read them all would name the wrong fault when
// one of them broke. What is read is that the core does not let a rock STAY in it
// and does not let one THROUGH it, which are the two wrong models: a build with no
// rock-and-core rule at all slings the rock straight through the star and out the
// far side, and a build that treats a rock the way `specs/collision.md` treats the
// ship pushes it back to the surface and leaves it grazing there.
//
// WHICH TICK IS "THE TICK AFTER". The tick after the sample that stands NEAREST the
// star's centre. On a build that takes the rock, the nearest sample is the last one
// before the taking — the rock is re-placed on an edge, which is at least `360`
// units out, so its distance leaps rather than shrinking further — and the tick
// after it is the tick the taking happened on. On a build that lets the rock
// through, the nearest sample is the one at the bottom of the pass, and the tick
// after it still has the rock inside the star. On a build that parks the rock on
// the surface, the nearest sample is the first one it spends there and the tick
// after it is another. One rule, three different readings.
//
// THE DROP IS RADIAL, straight down the star's column, so the well `specs/gravity.md`
// fixes acts exactly along the fall and cannot deflect it, and the rock's circle
// reaches the core rather than swinging past it. The rock is posed with an inward
// speed of its own as well, so `DROP_TICKS` covers the fall even on a build whose
// well is weaker than the specification's — the whole `124` units are inside it at
// the posed speed alone, with the well contributing nothing.
//
// THE FIELD HOLDS NOTHING ELSE. `startPlaying` empties every roster and shuts both
// world gates, so the one rock the drop reads is the one it posed and no wave can
// arrive behind it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { CORE_R, ROCK_RADIUS, STAR_X, STAR_Y } from "../constants";
import { starDistance } from "../geometry";
import {
  captureStill,
  centreOf,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** The size dropped: a Large, whose circle reaches the core furthest out. */
const SIZE = "large" as const;

/**
 * How far a Large's centre stands from the star's when its circle reaches the core:
 * `CORE_R + ROCK_RADIUS.large` (`76`), the distance `specs/collision.md` fixes for
 * the pair. The specification's figure, not the build's `radius`.
 */
const REACH = CORE_R + ROCK_RADIUS[SIZE];

/** Where the rock is dropped from: straight above the star, `200` units out. */
const FROM = { x: STAR_X, y: STAR_Y - 200 };

/** The inward speed it is dropped at, so the fall does not rest on the well. */
const DROP_SPEED = 200;

/**
 * The ticks the drop runs for: `0.8` seconds.
 *
 * The fall is `200 - REACH` = `124` units, which `DROP_SPEED` alone covers in
 * `0.62` seconds and the specification's well covers in `0.47`; so every build
 * whose rock is pulled inward at all has reached the core well inside this. And it
 * is short enough that a rock the star re-placed on an edge — at least `360` units
 * out (`specs/field.md`) — cannot drift back to within the `76` this reads before
 * the drop ends, so the nearest sample stays the one the taking followed.
 */
const DROP_TICKS = ticksFor(0.8);

/** How near the star's centre the nearest rock on the field stands, or nothing. */
function nearestRock(snapshot: ShatterSnapshot): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const rock of snapshot.rocks) {
    nearest = Math.min(nearest, starDistance(centreOf(rock)));
  }
  return nearest;
}

/**
 * How far outside `REACH` the rock may stop closing and still count as having
 * reached the core: `12` units.
 *
 * A scenario guard rather than a bound on the rule. `specs/collision.md` allows a
 * build to resolve the pair by sweeping the whole tick's path rather than by
 * testing where the tick ended, so the last sample before the taking stands
 * somewhere inside the tick or two of travel above `REACH` — at the `332` units per
 * second the specification's well brings the rock in at, four ticks. A rock that
 * stops closing further out than this was taken before its circle reached the core,
 * or was never falling at it, and the scenario says so rather than grading it.
 */
const EARLY = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has no rock at the core on the tick after one reached it", async () => {
  await startPlaying(h);
  await poseRock(h, SIZE, FROM.x, FROM.y, 0, DROP_SPEED);

  // The fall is radial and accelerating, so the rock closes on the star every tick
  // until something answers for it. The first tick that does not close is the tick
  // after the one that stood nearest, which is the tick this item reads.
  let closing = nearestRock(await h.snapshot());
  let after: ShatterSnapshot | null = null;
  for (let tick = 1; tick <= DROP_TICKS; tick += 1) {
    await h.advance(1);
    const snapshot = await h.snapshot();
    const distance = nearestRock(snapshot);
    if (!(distance < closing)) {
      after = snapshot;
      break;
    }
    closing = distance;
  }

  if (after === null) {
    fail(
      `a rock dropped from ${FROM.y} reaching the star's core inside ${DROP_TICKS} ticks (specs/collision.md)`,
      `it was still closing on the star, ${closing.toFixed(1)} units out, when the drop ended`,
    );
  }
  if (closing > REACH + EARLY) {
    fail(
      `a rock dropped at the star closing to the ${REACH} units at which its circle reaches the core (specs/collision.md)`,
      `it stopped closing ${closing.toFixed(1)} units out`,
    );
  }

  await captureStill(h, "taken");

  assertGreaterThan(
    nearestRock(after),
    REACH,
    `how far the nearest rock's centre stands from the star's on the tick after a rock's circle reached the core, having closed to ${closing.toFixed(1)} units (specs/rocks.md)`,
  );
});
