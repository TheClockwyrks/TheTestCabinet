// rocks/spin-is-cosmetic — a rock's drawn rotation never moves it.
//
// `specs/rocks.md`: "Each rock also carries a slow drawn rotation for visual life.
// That spin is cosmetic: it changes neither the rock's velocity nor its collision,
// so a rock under no force other than the well moves exactly along the path the
// well and its own momentum give it." A build that advances a rock's position by
// its drawn angle — a rotation applied to the body rather than to the sprite — has
// rocks that wander off their courses, and every other reading in this suite is
// quietly poisoned by it.
//
// THE READING IS THE TANGENTIAL ONE. A rock posed AT REST on a cleared field has
// exactly one force on it, `specs/gravity.md`'s well, and the well pulls "along the
// unit vector from the body to the star's centre" — so a second later both its
// velocity and its displacement must lie along that same line, and the component of
// either ACROSS it must be nothing. A spin that leaks into the simulation is
// tangential by its nature: it shows up as exactly that across-the-line component
// and as nothing else.
//
// THE ITEM IS DELIBERATELY NOT "THE ROCK STAYS WHERE IT WAS POSED". Every rock is a
// pulled body and `specs/gravity.md` fixes `MU` at 4,500,000, so even at the field's
// furthest corner from the star a conformant build's rock drifts several units in
// the second — an item asserting stillness would fail every specification-honouring
// build. And there is no operation that holds a rock out of the well: the debug
// surface deliberately carries none, because the well is this case's signature
// mechanic. So the check reads the direction of the motion the well produced,
// which is decidable, rather than its absence, which is not.
//
// THE BEARING IS TAKEN TO THE STAR'S CENTRE DIRECTLY, not by the shortest wrapped
// separation, because `specs/gravity.md` says the pull is: "The pull uses the body's
// direct vector to `(STAR_X, STAR_Y)`, not a wrapped one". At the quiet ground the
// two agree anyway, the star standing at the centre of the field.
//
// WHAT THIS DOES NOT DECIDE. That a rock IS drawn spinning, which no item grades
// and no build can be failed for by a headless reading; how hard the well pulls,
// which is `gravity/pull-magnitude`'s; and which way it pulls, which is
// `gravity/pull-direction`'s. What is added here is that nothing ELSE moved the
// rock.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import {
  DEG,
  STAR,
  angleBetween,
  directSeparation,
  headingOf,
  speedOf,
  unit,
} from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** How long the rock is left alone: one second of game time, as the item states. */
const DRIFT_TICKS = ticksFor(1);

/** How far off the line to the star either bearing may lie, as the item states. */
const TOLERANCE_DEGREES = 1;

/** The across-the-line component allowed of the velocity, in units per second. */
const TOLERANCE_SPEED = 1;

/** The across-the-line component allowed of the displacement, in units. */
const TOLERANCE_DISTANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a rock left at rest straight down the line to the star, and not across it", async () => {
  startPlaying(h);
  const rockId = poseRock(h, "large", QUIET_CORNER.x, QUIET_CORNER.y);
  const posed = requireRock(h.snapshot(), rockId, "the rock posed at rest");

  await h.advance(DRIFT_TICKS);
  captureStill(h, "spin");

  const now = requireRock(
    h.snapshot(),
    rockId,
    "the rock a second after it was posed at rest",
  );

  // The line the well pulls along, from where the rock was posed.
  const toStar = directSeparation(posed, STAR);
  const line = Math.atan2(toStar.y, toStar.x);
  const across = unit(line + Math.PI / 2);

  const moved = { x: now.x - posed.x, y: now.y - posed.y };

  // The control the two bearings below rest on. A rock that never moved has no
  // velocity and no displacement, so the bearing of either is `atan2(0, 0)` —
  // zero, an angle it never chose — and a build whose rocks are inert would read
  // "along the line" by accident at any ground where that zero happens to sit
  // near the bearing to the star. The well pulls every rock (specs/gravity.md),
  // so a conformant build has both figures above nothing, and the readings after
  // these are readings of a motion that actually happened.
  assertGreaterThan(
    speedOf(now),
    0,
    "units per second the well gave a rock left at rest for a second, which " +
      "is what makes the bearing of its velocity a bearing it chose " +
      "(specs/gravity.md)",
  );
  assertGreaterThan(
    Math.hypot(moved.x, moved.y),
    0,
    "units the rock moved over that second, which is what makes the bearing " +
      "of its displacement a bearing it chose (specs/gravity.md)",
  );

  assertLessThanOrEqual(
    angleBetween(headingOf(now), line) / DEG,
    TOLERANCE_DEGREES,
    "degrees between the rock's velocity and the line to the star's centre, " +
      "a second after it was posed at rest with the well as its only force " +
      "(specs/gravity.md, specs/rocks.md)",
  );
  assertLessThanOrEqual(
    angleBetween(Math.atan2(moved.y, moved.x), line) / DEG,
    TOLERANCE_DEGREES,
    "degrees between the rock's displacement and the line to the star's " +
      "centre (specs/gravity.md, specs/rocks.md)",
  );
  assertLessThanOrEqual(
    Math.abs(now.vx * across.x + now.vy * across.y),
    TOLERANCE_SPEED,
    "units per second of the rock's velocity lying ACROSS the line to the " +
      "star — the component a spin that moved the body would show up as, and " +
      "the only thing that could have produced it (specs/rocks.md)",
  );
  assertLessThanOrEqual(
    Math.abs(moved.x * across.x + moved.y * across.y),
    TOLERANCE_DISTANCE,
    "units the rock moved ACROSS the line to the star in the second it was " +
      "left alone (specs/rocks.md)",
  );
});
