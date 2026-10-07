// rocks/radius-large — a Large collides as a circle of ROCK_RADIUS.large (46).
//
// `specs/collision.md` fixes the geometry twice over: "Whatever a body is drawn as,
// it collides as a circle of the radius below, centred on its position", with a
// Large rock at `ROCK_RADIUS.large` (46) and a bullet at `BULLET_R` (3); and
// "Two bodies touch when the shortest wrapped separation between their centres [...]
// is at most the sum of their radii". So a round whose line passes within 49
// units of a Large's centre touches it, and one passing further does not.
// `specs/rocks.md` says the same from the other side: a rock "collides as a circle
// of the radius below, whatever it is drawn as".
//
// THE ITEM IS DECIDED ON A PAIR, one probe either side of that figure: a round
// passing 44 units from the centre — 5 units inside contact — and one passing
// 50 — 1 unit outside it. A build whose rock collides at its DRAWN
// extent, or at its diameter, or at the radius of the size above, reads one probe
// or the other differently, and a build with no collision at all fails the first.
// A single probe could not do it: an inside-only check passes a build that collides
// at twice the radius, and an outside-only one passes a build that never collides.
//
// EACH PROBE IS ITS OWN ISOLATED WORLD, posed by `startPlaying` and holding one
// rock and one round. Nothing else is on the field, so the round can be spent on
// nothing but the rock and the well is the only other thing acting.
//
// THE ROUND CARRIES THE ROCK'S OWN VELOCITY (`scenario.ts`), so the offset the
// check states is exactly the distance the round's line passes the centre by. It is
// fired from the side facing AWAY from the star and inward, so `specs/collision.md`'s
// absorption at the core cannot take it before it gets there, and the whole probe
// stands on the quiet ground `412` units from the star, where the well's
// differential pull on two bodies 49 units apart moves that offset by
// hundredths of a unit over the flight — a fiftieth of the 1-unit margin the
// outside probe rests on.
//
// WHAT THIS DOES NOT DECIDE. That the destroyed rock splits, which is
// `rocks/split-large`'s; that a fast round is not stepped over, which is
// `bullets/no-tunnelling-at-speed`'s; and, under `warhead`, how many hits the kill
// took, which is `armor/health-large-*`'s — this fires until the rock is gone
// exactly because that number differs between the variants.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R, ROCK_RADIUS } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireBullet,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ROCK_GROUND, inwardHeading, passAt, travelledPast } from "./scenario";

/**
 * The separation at which a round touches a Large: the sum of the two radii
 * `specs/collision.md` states, `ROCK_RADIUS.large` (46) plus `BULLET_R` (3).
 * The two probes below straddle it.
 */
const CONTACT = ROCK_RADIUS.large + BULLET_R;

/** The inside probe: 44 units from the centre, 5 inside contact. */
const INSIDE = 44;

/** The outside probe: 50 units from the centre, 1 outside contact. */
const OUTSIDE = 50;

/**
 * How far past the rock's centre the outside round must have travelled before it
 * counts as a miss rather than as a round still on its way.
 *
 * A whole radius beyond the centre, so the round is clear of the rock's entire
 * circle. `scenario.ts` gives a round a quarter of a second at `MUZZLE_SPEED`
 * (520) — 130 units — from a start `roundReach` (53) units back, so a
 * conformant build carries it well past this.
 */
const CLEAR_OF = ROCK_RADIUS.large;

/** Ticks of the aftermath filmed after the readings, so the still is not the frame of the measurement. */
const AFTERMATH_TICKS = ticksFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("is destroyed by a round passing 44 units from its centre and untouched by one passing 50", async () => {
  // The inside probe, in a world of its own.
  startPlaying(h);
  const struckId = poseRock(h, "large", ROCK_GROUND.x, ROCK_GROUND.y);
  const inside = await passAt(h, struckId, INSIDE);

  // The outside probe, in a fresh one: `startPlaying` clears the field, so the
  // first probe's fragments cannot be what the second round is spent on.
  startPlaying(h);
  const sparedId = poseRock(h, "large", ROCK_GROUND.x, ROCK_GROUND.y);
  const spared = requireRock(
    h.snapshot(),
    sparedId,
    "the Large the round passes",
  );
  const heading = inwardHeading(spared);
  const outside = await passAt(h, sparedId, OUTSIDE);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "radius");

  assertEqual(
    inside.destroyed,
    true,
    `a Large destroyed by rounds whose line passes ${INSIDE} units from its ` +
      `centre, inside the ${CONTACT} units at which a bullet touches a circle ` +
      `of ROCK_RADIUS.large (${ROCK_RADIUS.large}) (specs/collision.md)`,
  );

  assertEqual(
    outside.destroyed,
    false,
    `the Large still on the field after a round whose line passes ` +
      `${OUTSIDE} units from its centre, outside the ${CONTACT} units at ` +
      "which a bullet touches it (specs/collision.md)",
  );
  assertEqual(
    outside.last.spent,
    false,
    `the round passing ${OUTSIDE} units from the Large's centre still in ` +
      "flight: a round that misses is not removed (specs/collision.md)",
  );

  // And it really did pass the rock, rather than being read while still on its
  // way in — so a build whose collision never runs is told from one whose rock
  // is the size the specification fixes.
  const round = requireBullet(
    outside.last.at,
    outside.last.bullet,
    "the round that passed the Large",
  );
  const rock = requireRock(
    outside.last.at,
    sparedId,
    "the Large the round passed",
  );
  assertGreaterThan(
    travelledPast(round, rock, heading),
    CLEAR_OF,
    `units the surviving round travelled past the Large's centre, along the ` +
      "line it was fired on",
  );
});
