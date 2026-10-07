// instrumentation/torpedo-homing-gate — with `setTorpedoHoming(id, false)` a
// torpedo holds its heading past a rock squarely inside its forward cone; with
// it on, the same pose turns it onto that rock. `warhead` only.
//
// THE RULE. `specs/instrumentation.md`, The torpedoes: "`setTorpedoHoming(id,
// enabled)` Gates that torpedo's guidance alone: the forward-cone acquisition
// and the turn onto a target. Off, it holds its heading. Its travel, its
// lifetime, and its impacts run on." The guidance itself is `specs/weapons.md`:
// "A body is a candidate when it is a rock or the saucer and its bearing from
// the torpedo lies within `TORPEDO_CONE` (`15` degrees) of the torpedo's current
// heading, on either side ... With a target, the torpedo turns its heading toward
// that target's current position at up to `TORPEDO_TURN` (`160` degrees per
// second), keeping its speed."
//
// WHY THE ITEM EXISTS. A `setTorpedoHoming` that does nothing fails
// `torpedo/flies-true-through-the-well`, whose domains are gravity and arcade —
// so a broken instrumentation gate would lower the GRAVITY rating of a build
// whose well is perfectly correct. This item is where that fault is named.
//
// THE ROCK IS SQUARELY INSIDE THE CONE AND SQUARELY OFF THE HEADING, and both
// halves matter. At `8` degrees off a heading of `0` it is well inside the
// `15`-degree half-angle, so a conformant build's guidance acquires it and there
// is no argument about the edge of the cone; and it is far enough off that the
// turn onto it is a reading rather than a rounding — a build that holds reports a
// heading of `0` and one that homes reports several degrees of turn toward the
// rock, which are different numbers rather than the same one measured twice.
//
// NOTHING ELSE IS ACQUIRABLE. `startPlaying` empties the field, so the one rock
// posed is the only candidate: the ship is not a candidate at all
// (`specs/weapons.md` names rocks and the saucer), and no saucer is up. A second
// body inside the cone would make "the nearest" the thing under test.
//
// THE STRETCH IS SHORT AND FAR FROM EVERYTHING. Three tenths of a second carries
// the torpedo `126` units, a quarter of the way to a rock `505` units off, so it
// never lands and the reading is of the heading rather than of an impact. The
// whole path stays more than `450` units from `(STAR_X, STAR_Y)`, and the well
// never pulls a torpedo in any case (`specs/gravity.md`), so nothing bends the
// heading but the guidance this item gates.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT, TORPEDO_CONE, TORPEDO_TURN } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { angleBetween, bearing } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  requireTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import { poseTorpedo } from "./torpedo";

/** Where the torpedo starts, and the heading it is launched on: along `+x`. */
const START = { x: 200, y: 660 };
const HEADING = 0;

/**
 * Where the rock stands: `8` degrees off that heading, `505` units out.
 *
 * The gap in `x` is deliberately under half the field's width. Every bearing in
 * this game is taken along the SHORTEST WRAPPED separation (`specs/field.md`,
 * and `specs/weapons.md` for the cone itself), so a rock more than `FIELD_W / 2`
 * ahead of the torpedo is a rock BEHIND it through the seam — and
 * `specs/weapons.md` says a body behind the torpedo is never acquired. Posed
 * here, the direct approach and the wrapped one are the same approach.
 */
const ROCK_AT = { x: 700, y: 590 };

/** How long each leg runs, in seconds of game time. */
const FLIGHT_SECONDS = 0.3;

/**
 * How far a held heading may move, in radians.
 *
 * A quarter of the turn one tick of guidance is worth. `specs/weapons.md` turns
 * an acquired torpedo at up to `TORPEDO_TURN` per second, so one tick is
 * `TORPEDO_TURN * TICK_DT` (`1.33` degrees); a build honouring the gate turns
 * none of it, and a build that ran its guidance for even one tick of the
 * thirty-six is outside this bound.
 */
const HELD_TOLERANCE = (TORPEDO_TURN * TICK_DT) / 4;

/**
 * How near a running guidance must have brought the heading to the bearing to its
 * target, in radians.
 *
 * TWO TICKS OF THE TURN RATE `specs/weapons.md` FIXES: `2 * TORPEDO_TURN * TICK_DT`,
 * some `2.67` degrees. The guidance re-evaluates every tick and turns toward the
 * target's CURRENT position, so a torpedo tracking a target that is itself moving
 * sits a tick or two behind the bearing rather than exactly on it — and nothing
 * else it could be doing sits inside that.
 *
 * IT IS AN ABSOLUTE BOUND AND NOT A FRACTION OF THE ANGLE IT STARTED AT. A build
 * that turns halfway onto its target and then stops has not turned ONTO it, which
 * is what `specs/instrumentation.md` says a running gate makes it do; a bound of
 * "half the offset it was posed at" passes that build, and this is the reading the
 * other two engines already take.
 */
const ACQUIRED_TOLERANCE = 2 * TORPEDO_TURN * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose the rock and the torpedo, gate the guidance, and answer the two ids. */
function poseApproach(homing: boolean): { rock: number; torpedo: number } {
  startPlaying(h);
  const rock = poseRock(h, "large", ROCK_AT.x, ROCK_AT.y);
  const torpedo = poseTorpedo(h, START.x, START.y, HEADING);
  requireOp(h.debug, "setTorpedoHoming")(torpedo, homing);
  assertEqual(
    requireTorpedo(h.snapshot(), torpedo, "the posed torpedo").homing,
    homing,
    `setTorpedoHoming(id, ${homing}) reads back`,
  );
  return { rock, torpedo };
}

/** How far off the torpedo's heading the rock's bearing lies, in radians. */
function offsetToRock(rock: number, torpedo: number): number {
  const snapshot = h.snapshot();
  const target = requireRock(snapshot, rock, "the acquirable rock");
  const shot = requireTorpedo(snapshot, torpedo, "the torpedo in flight");
  return angleBetween(shot.heading, bearing(shot, target));
}

it("off, the torpedo holds its heading past a rock inside its cone", async () => {
  const { rock, torpedo } = poseApproach(false);

  const posed = offsetToRock(rock, torpedo);
  assertLessThan(
    posed,
    TORPEDO_CONE,
    "the rock is squarely inside the torpedo's forward cone as posed " +
      "(specs/weapons.md)",
  );

  await h.advance(ticksFor(FLIGHT_SECONDS));

  // The torpedo holding its heading past an acquirable rock.
  captureStill(h, "held");

  const flown = requireTorpedo(h.snapshot(), torpedo, "the held torpedo");
  assertLessThanOrEqual(
    angleBetween(flown.heading, HEADING),
    HELD_TOLERANCE,
    `with homing off the torpedo holds the heading it was launched on, ` +
      `past a rock ${((posed * 180) / Math.PI).toFixed(1)} degrees off it`,
  );
  assertEqual(flown.homing, false, "the gate is still off");
});

it("on, the same pose turns it onto that rock", async () => {
  const { rock, torpedo } = poseApproach(true);

  const posed = offsetToRock(rock, torpedo);
  assertLessThan(
    posed,
    TORPEDO_CONE,
    "the rock is squarely inside the torpedo's forward cone as posed " +
      "(specs/weapons.md)",
  );

  await h.advance(ticksFor(FLIGHT_SECONDS));

  const closed = offsetToRock(rock, torpedo);
  assertLessThanOrEqual(
    closed,
    ACQUIRED_TOLERANCE,
    "with homing on, the angle between the torpedo's heading and the bearing " +
      `to the rock, having been posed ${((posed * 180) / Math.PI).toFixed(1)} ` +
      "degrees off it — a running gate turns the torpedo ONTO its target " +
      "(specs/instrumentation.md, specs/weapons.md), not merely toward it",
  );
  const flown = requireTorpedo(h.snapshot(), torpedo, "the homing torpedo");
  assertGreaterThan(
    angleBetween(flown.heading, HEADING),
    HELD_TOLERANCE,
    "and its heading is no longer the one it was launched on",
  );
});
