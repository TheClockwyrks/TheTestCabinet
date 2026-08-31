// gravity/enemy-bullet-curves — the well bends a saucer bullet by the same law.
//
// `specs/gravity.md` lists "a saucer bullet" among the pulled bodies, beside the
// ship's own, and `specs/saucer.md` says it again from the saucer's side: what it
// fires is pulled by the well and wraps at the edges like any ballistic body. The
// saucer ITSELF is a powered craft the well never touches
// (`gravity/saucer-free`); what it fires is ballistic, and a build that carried
// its owner's exemption over to its shots is what this item catches.
//
// THE SAME SHOT, DELIBERATELY. The review item states it as an enemy bullet posed
// "on the same line as bullet-curves", so this poses the identical flight: the
// same start on the line 150 units above the star's row, the same velocity along
// it, the same 1.25 seconds and the same 40-unit figure. "The same law" is then a
// like-for-like reading rather than an argument from two different numbers — a
// build whose two rosters are pulled differently fails exactly one of the two
// items, and the pair says which.
//
// The velocity is `MUZZLE_SPEED` rather than `SAUCER_BULLET_SPEED` for that
// reason alone. `specs/instrumentation.md` has `addEnemyBullet` take the velocity
// it is given, and `specs/gravity.md` makes the acceleration a function of
// POSITION alone, so how fast the round is travelling is not a thing the law
// reads — what the shared speed buys is that the two items compare.
//
// The flight is safe on the same three counts `bullet-curves` sets out: it never
// comes nearer the core than about 139 units against a `CORE_R +
// SAUCER_BULLET_R` of 33; 1.25 seconds is inside the `SAUCER_BULLET_LIFE` (1.4 s)
// that `specs/instrumentation.md` gives a posed enemy bullet; and
// `specs/collision.md` gives a saucer bullet nothing on an empty field to hit —
// the ship's lethal contact test is off under `startPlaying`, and it stands 300
// units off this line in any case.
//
// AND WHICH WAY IT BENT, on the same terms: a round deflected 60 units the wrong
// way would clear a distance test while doing the opposite of what the well does,
// so the deviation across the shot's heading is read too.

import { afterEach, beforeEach, it } from "vitest";
import { MUZZLE_SPEED, STAR_Y } from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBulletById,
  poseEnemyBullet,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { STAR, distance, separation, wrap } from "../geometry";
import { add, componentAcross, scale, subtract, type Point } from "./law";

/** How far from the star's centre the shot's line passes: bullet-curves' figure. */
const MISS_DISTANCE = 150;

/** Where the shot starts: bullet-curves' start, on that line. */
const START: Point = { x: 240, y: STAR_Y - MISS_DISTANCE };

/** The shot's velocity: bullet-curves' velocity, straight along the line. */
const SHOT: Point = { x: MUZZLE_SPEED, y: 0 };

/** How long it is followed. Inside `SAUCER_BULLET_LIFE` (1.4 s). */
const FLIGHT_TICKS = ticksFor(1.25);

/** How far it must end from the unbent shot, in units: bullet-curves' figure. */
const MIN_DEVIATION = 40;

/** Where a round under no acceleration at all would have reached. */
const UNBENT: Point = wrap(add(START, scale(SHOT, secondsFor(FLIGHT_TICKS))));

/** Which way across the shot's heading the star lies, as a sign. */
const TOWARD_STAR = Math.sign(componentAcross(subtract(STAR, START), SHOT));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("bends a saucer bullet off the line an unbent one would have held", async () => {
  startPlaying(h);
  const id = poseEnemyBullet(h, START.x, START.y, SHOT.x, SHOT.y);

  await h.advance(FLIGHT_TICKS);
  captureStill(h, "curve");

  const shot = enemyBulletById(
    h.snapshot(),
    id,
    `a saucer bullet ${secondsFor(FLIGHT_TICKS)} seconds into a ` +
      `${MISS_DISTANCE}-unit pass of the star`,
  );
  const ended: Point = { x: shot.x, y: shot.y };
  const deviation = separation(UNBENT, ended);

  assertGreaterThan(
    distance(UNBENT, ended),
    MIN_DEVIATION,
    "units between where the saucer bullet ended and where an unpulled one " +
      "would have (specs/gravity.md: a saucer bullet is pulled)",
  );
  assertGreaterThan(
    componentAcross(deviation, SHOT) * TOWARD_STAR,
    0,
    "units the saucer bullet was deflected across its heading, signed toward " +
      "the star",
  );
});
