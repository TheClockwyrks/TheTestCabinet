// detonation/scatter-is-radial — the torpedo's fan lies ALONG the blast, not across it.
//
// `specs/collision.md` gives the two fans different directions as well as
// different magnitudes. A gun kill throws its fragments "perpendicular to the
// bullet's travel at the moment it landed", and the spec then spells the
// convention out — "taken from the bullet's own direction of travel, not from the
// rock's course, so the fan lies ACROSS the shot". A torpedo kill instead directs
// its kick "radially outward from the destroyed rock's centre, the two fragments
// blasted to opposite sides": away from the point the blast came from, along the
// line the torpedo arrived on, rather than across it. The magnitude is
// `harder-scatter`'s; this is the direction alone.
//
// WHAT MAKES IT DECIDABLE: A HEAD-ON HIT ALONG A KNOWN LINE. Both fragments appear
// at the destroyed rock's own position (`specs/rocks.md`), so there is no offset
// between them to read a direction off — the direction has to come from the
// geometry of the impact. So the torpedo is flown dead through the rock's centre
// along `+x`, and the two candidate conventions then sit ninety degrees apart:
//
//   radially outward from the centre    the kick axis is HORIZONTAL
//   across the torpedo's travel         the kick axis is VERTICAL
//
// and a build with the gun's rule wired to the torpedo reads ninety degrees off a
// bound of ten.
//
// THE ROCK DRIFTS ALONG THE SHOT'S OWN LINE, at `ROCK_SPEED_MIN.large` (60), the
// slowest drift `specs/rocks.md` gives a Large. Two things follow, and both are
// the point. A build that kicks perpendicular to THE ROCK'S COURSE rather than to
// the weapon's — the confusion `specs/collision.md` rules out in as many words,
// and one two graded builds have shipped — reads vertical here too, so it fails
// alongside the gun-convention build instead of hiding behind a rock at rest,
// whose course is no direction at all. And because the drift lies along the
// torpedo's line rather than across it, the torpedo still closes on the rock's
// CENTRE: the approach stays head-on, and the radius through the point of impact
// stays the same axis as the torpedo's own heading, so a build that reads either
// of them passes and only a build that reads the perpendicular fails.
//
// EACH FRAGMENT IS READ SEPARATELY, which is what the item states, against the
// parent's velocity taken from the snapshot on the tick BEFORE the kill, so what
// the well was doing to the parent is subtracted rather than measured.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, ROCK_SPEED_MIN } from "../../src/constants";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  QUIET_GROUND,
  axisOffsetOf,
  degrees,
  driveTorpedo,
  fragmentPair,
  launchAt,
} from "./scenario";

/** The line the torpedo travels along: straight along `+x`. */
const SHOT_HEADING = 0;

/**
 * The parent's drift, along the shot's own line and against it.
 *
 * `ROCK_SPEED_MIN.large` (60) is the slowest drift `specs/rocks.md` gives a Large,
 * so the arrangement is one the game itself produces. Along `-x` against a shot
 * along `+x`, so the closing is head-on through the centre and the reading is not
 * confounded by an off-centre hit.
 */
const PARENT_VX = -ROCK_SPEED_MIN.large;
const PARENT_VY = 0;

/**
 * How far a fragment's kick may lie from the torpedo's line, as the review item
 * states: ten degrees.
 *
 * Room for the build's arithmetic, not for the environment. The parent's velocity
 * is read one tick before the kill, so the well has added about a fifth of a unit
 * per second at this placement (some `26` units per second squared over one tick
 * of `TICK_HZ`) to a kick of `TORPEDO_SCATTER` (240): under a twentieth of a
 * degree. The wrong model this bound is set against reads ninety degrees, so
 * nothing rests on where between the two the line is drawn.
 */
const TOLERANCE_DEGREES = 10;

/** Ticks of the fragments coming apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("kicks both fragments along the torpedo's line rather than across it", async () => {
  startPlaying(h);
  const parentId = poseRock(
    h,
    "large",
    QUIET_GROUND.x,
    QUIET_GROUND.y,
    PARENT_VX,
    PARENT_VY,
  );
  const parent = requireRock(h.snapshot(), parentId, "the drifting Large");

  const torpedo = launchAt(
    h,
    { x: parent.x, y: parent.y, radius: ROCK_RADIUS.large },
    SHOT_HEADING,
  );
  const run = await driveTorpedo(h, torpedo);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "scatter");

  assertTrue(
    run.hit,
    "the torpedo spent on the Large it was flown into (specs/collision.md)",
  );

  // The parent as it stood on the last tick it was still whole, so the drift the
  // well had added to it is subtracted rather than measured.
  const struck = requireRock(
    run.before,
    parentId,
    "the Large on the tick it broke",
  );
  const [first, second] = fragmentPair(run.at, "medium", "scatter-is-radial");

  for (const [index, fragment] of [first, second].entries()) {
    const kick = {
      x: fragment.vx - struck.vx,
      y: fragment.vy - struck.vy,
    };
    assertLessThanOrEqual(
      degrees(axisOffsetOf(kick, SHOT_HEADING)),
      TOLERANCE_DEGREES,
      `fragment ${String(index + 1)}: its kick along the torpedo's line, in ` +
        "degrees off it (specs/collision.md)",
    );
  }
});
