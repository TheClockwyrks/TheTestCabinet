// gravity/enemy-bullet-curves — the well bends a saucer bullet by the same law.
//
// `specs/gravity.md` lists "a saucer bullet" among the pulled bodies, beside the
// ship's own, and `specs/saucer.md` says it again from the saucer's side: its
// bullet "is pulled by the well and wraps at the edges like any ballistic body".
// The saucer itself is a powered craft the well never touches
// (`gravity/saucer-free`); what it FIRES is ballistic, and a build that carried
// its owner's exemption over to its shots is what this item catches.
//
// THE SAME SHOT, DELIBERATELY. The review item states it as an enemy bullet
// "posed on the same line as bullet-curves", so this poses the identical flight:
// the same start on the line 150 units above the star's row, the same velocity
// along it, the same 1.25 seconds, and the same 40-unit figure. "The same law"
// is then a like-for-like reading rather than an argument from two different
// numbers — a build whose two rosters are pulled differently fails exactly one of
// the two items, and the pair says which.
//
// The velocity is `MUZZLE_SPEED` rather than `SAUCER_BULLET_SPEED` for that
// reason alone. `specs/instrumentation.md` has `addEnemyBullet` take the velocity
// it is given, and `specs/gravity.md` makes the acceleration a function of
// position alone, so how fast the round is travelling is not a thing the law
// reads — what the shared speed buys is that the two items compare.
//
// The flight is safe on the same three counts bullet-curves sets out: it never
// comes nearer the core than about 139 units against a `CORE_R +
// SAUCER_BULLET_R` of 33; 1.25 seconds is inside the 1.4 of `SAUCER_BULLET_LIFE`
// that `specs/instrumentation.md` gives a posed enemy bullet; and
// `specs/collision.md` gives a saucer bullet nothing on an empty field to hit.
//
// AND WHICH WAY IT BENT, on the same terms: a round deflected 60 units the wrong
// way would clear a distance test while doing the opposite of what the well does,
// so the deviation across the shot's heading is read too.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { MUZZLE_SPEED, STAR_X, STAR_Y } from "../constants";
import {
  captureStill,
  centreOf,
  createHarness,
  enemyBulletById,
  poseEnemyBullet,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  add,
  componentAcross,
  scale,
  shortestDelta,
  subtract,
  wrap,
  wrappedDistance,
  type Vec,
} from "../geometry";

/** How far from the star's centre the shot's line passes: bullet-curves' figure. */
const MISS_DISTANCE = 150;

/** Where the shot starts: bullet-curves' start, on that line. */
const START: Vec = { x: 240, y: STAR_Y - MISS_DISTANCE };

/** The shot's velocity: bullet-curves' velocity, straight along the line. */
const SHOT: Vec = { x: MUZZLE_SPEED, y: 0 };

/** How long it is followed. Inside `SAUCER_BULLET_LIFE` (1.4 s). */
const FLIGHT_TICKS = ticksFor(1.25);

/** How far it must end from the unbent shot, in units: bullet-curves' figure. */
const MIN_DEVIATION = 40;

/** Where a round under no acceleration at all would have reached. */
const UNBENT: Vec = wrap(add(START, scale(SHOT, secondsFor(FLIGHT_TICKS))));

/** Which way across the shot's heading the star lies, as a sign. */
const TOWARD_STAR = Math.sign(
  componentAcross(subtract({ x: STAR_X, y: STAR_Y }, START), SHOT),
);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("bends a saucer bullet off the line an unbent one would have held", async () => {
  await startPlaying(harness);
  const id = await poseEnemyBullet(harness, START.x, START.y, SHOT.x, SHOT.y);

  await harness.advance(FLIGHT_TICKS);
  await captureStill(harness, "curve");

  const snapshot = await harness.snapshot();
  const shot = enemyBulletById(snapshot, id);
  if (shot === undefined) {
    // Hard-asserted before it is read, so a build that removed the round fails
    // THIS item rather than crashing the script two lines below.
    fail(
      `a saucer bullet ${secondsFor(FLIGHT_TICKS)} seconds into a ${MISS_DISTANCE}-unit pass: the bullet ${id} still in flight`,
      `the saucer-bullet roster holds ${JSON.stringify(
        snapshot.enemyBullets.map((each) => each.id),
      )}`,
    );
  }
  const deviation = shortestDelta(UNBENT, centreOf(shot));

  assertGreaterThan(
    wrappedDistance(UNBENT, centreOf(shot)),
    MIN_DEVIATION,
    "units between where the saucer bullet ended and where an unpulled one would have",
  );
  assertGreaterThan(
    componentAcross(deviation, SHOT) * TOWARD_STAR,
    0,
    "units the saucer bullet was deflected across its heading, toward the star",
  );
});
