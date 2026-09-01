// instrumentation/torpedo-heading — `setTorpedoHeading(id, radians)` turns one
// torpedo and its velocity turns with it, at the speed it already had. `warhead`
// only.
//
// THE RULE. `specs/instrumentation.md`, The torpedoes: "`setTorpedoHeading(id,
// radians)` | Sets that torpedo's heading. Its speed is unchanged, so its velocity
// turns with it." Two claims in one sentence, and the second is what makes the
// operation more than a cosmetic field: the heading a build reports and the
// direction it actually flies must be the same thing after the pose, and the speed
// must be the one it was carrying.
//
// WHY THE POINT EXISTS. Every other operation of the debug surface is graded by an
// item of its own — the per-roster clears, the per-id removals, the world gates,
// the saucer faculties, `setRockHealth`, `setTorpedoHoming` — and the snapshot
// shape is built on the rule that "every operation is verifiable by setting a value
// and reading it back". A pose no item drives is a requirement the specification
// charges every build for and the case never reads, so this one drives it.
//
// WHAT IS READ, AND WHY IT IS THREE READINGS AND NOT ONE. The reported heading, so
// a build that stored the pose somewhere the snapshot does not report fails; the
// magnitude of the reported velocity, so a build that rebuilt the velocity from a
// default speed rather than the one it held fails; and the DIRECTION of that
// velocity, so a build that moved the heading field alone and left the velocity
// pointing the old way fails. A build that did all three right passes, however it
// stores a torpedo.
//
// AND THE POSE IS READ WITHOUT ADVANCING. `specs/instrumentation.md` makes
// `snapshot` a pure read of the state, so the value a pose wrote is there the
// instant it is asked for; advancing first would grade the tick rather than the
// pose.
//
// THE GUIDANCE IS HELD OFF AND THE FIELD IS EMPTY, so nothing in the game can turn
// this torpedo except the operation under test. `startPlaying` has emptied every
// roster and shut both world gates, so there is no rock and no saucer to acquire in
// any case, and the pose stands `453` units from the star, which never pulls a
// torpedo at all (`specs/gravity.md`).
//
// THE TWO HEADINGS ARE 130 DEGREES APART AND NEITHER IS AN AXIS. A pose onto `0`, a
// quarter turn or a half turn could be read back by a build that had simply left
// the velocity as it was; `130` degrees off `-25` is neither the one it was on nor
// anything a default would produce.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, TORPEDO_SPEED } from "../../src/constants";
import { assertCloseTo, assertLessThanOrEqual, fail } from "../assert";
import { angleGap, degrees, headingOf, speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  poseTorpedo,
  startPlaying,
  torpedoById,
  type Harness,
} from "../harness";

/** Where the torpedo hangs: low and left, `453` units from the star's centre. */
const PLACE = { x: 300, y: 660 } as const;

/** The heading it is launched on, and the one it is turned to. See the header. */
const LAUNCHED = -25 * DEG;
const TURNED = LAUNCHED + 130 * DEG;

/**
 * The decimal places the posed heading is read back to.
 *
 * Six, which is to say exactly: a pose writes a number and a read returns it, and
 * `specs/instrumentation.md` puts no arithmetic between the two.
 */
const READ_BACK_DIGITS = 6;

/**
 * How far the turned velocity may lie from the heading it was posed on, in radians.
 *
 * A tenth of a degree. The velocity is `TORPEDO_SPEED` times the cosine and sine of
 * an angle a build was handed, so a conformant build is off by float rounding
 * alone; this is room for that and for nothing else. A build that left the velocity
 * on the launch heading reads `130` degrees off it.
 */
const DIRECTION_TOLERANCE = 0.1 * DEG;

/**
 * How far the turned speed may lie from the speed it was carrying, in units per
 * second.
 *
 * A hundredth of a unit per second on `TORPEDO_SPEED` (`420`). "Its speed is
 * unchanged" is an equality, and rebuilding a velocity from an angle costs a build
 * nothing but rounding.
 */
const SPEED_TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns a torpedo onto the posed heading and turns its velocity with it", () => {
  startPlaying(h);
  const id = poseTorpedo(h, PLACE.x, PLACE.y, LAUNCHED);
  if (h.debug.setTorpedoHoming === undefined) {
    fail(
      "a setTorpedoHoming operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.setTorpedoHoming(id, false);

  // What it was carrying before the turn, read off the build's own snapshot rather
  // than assumed: the speed the pose must leave unchanged is this one.
  const launched = torpedoById(h.snapshot(), id, "the posed torpedo");
  assertCloseTo(
    launched.heading,
    LAUNCHED,
    READ_BACK_DIGITS,
    "addTorpedo(x, y, heading) reads back the heading it was handed",
  );
  assertCloseTo(
    speedOf(launched),
    TORPEDO_SPEED,
    2,
    "the speed a torpedo is added at, TORPEDO_SPEED " +
      `(${TORPEDO_SPEED}) (specs/instrumentation.md)`,
  );

  if (h.debug.setTorpedoHeading === undefined) {
    fail(
      "a setTorpedoHeading operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.setTorpedoHeading(id, TURNED);
  captureStill(h, "turned");
  const turned = torpedoById(h.snapshot(), id, "the turned torpedo");

  assertCloseTo(
    turned.heading,
    TURNED,
    READ_BACK_DIGITS,
    "setTorpedoHeading reads back on the snapshot's heading",
  );
  assertLessThanOrEqual(
    Math.abs(speedOf(turned) - TORPEDO_SPEED),
    SPEED_TOLERANCE,
    "the units per second the turned torpedo's speed moved from the " +
      `${TORPEDO_SPEED} it was carrying — "Its speed is unchanged" ` +
      "(specs/instrumentation.md)",
  );
  const flying = headingOf(turned);
  if (flying === null) {
    fail(
      "a turned torpedo still carrying a velocity, so the direction it flies " +
        'can be read — "so its velocity turns with it" ' +
        "(specs/instrumentation.md)",
      "its reported velocity was (0, 0)",
    );
  }
  assertLessThanOrEqual(
    degrees(angleGap(flying, TURNED)),
    degrees(DIRECTION_TOLERANCE),
    "the degrees between the turned torpedo's reported velocity and the " +
      'heading it was posed on — "so its velocity turns with it" ' +
      "(specs/instrumentation.md)",
  );
  assertCloseTo(
    turned.x,
    PLACE.x,
    READ_BACK_DIGITS,
    "setTorpedoHeading moves no position: x",
  );
  assertCloseTo(
    turned.y,
    PLACE.y,
    READ_BACK_DIGITS,
    "setTorpedoHeading moves no position: y",
  );
});
