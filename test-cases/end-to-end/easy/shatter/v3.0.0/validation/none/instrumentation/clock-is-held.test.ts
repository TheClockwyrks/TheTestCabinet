// instrumentation/clock-is-held — with the clock held, nothing advances unless a
// step asks it to.
//
// TWO LEGS, AND EACH NAMES A DIFFERENT WRONG MODEL.
//
//   1. `advance(0)` RUNS NOTHING. `specs/instrumentation.md` says so in as many
//      words: "`ticks` is a non-negative whole number, and `advance(0)` runs
//      nothing at all". A build whose accumulator forces a minimum step, or which
//      runs a tick on the way into `advance` before it counts, moves the field on a
//      call that asked for no time at all — and every scenario in this project that
//      reads a state before driving it then reads a state one tick past the one it
//      posed.
//   2. REAL TIME BUYS NOTHING. `setAutoStep(false)` "stops the frame loop advancing
//      the simulation from the wall clock, so the game changes only when `advance`
//      says so". The harness opens every check with the clock held, so a build that
//      only PRETENDED to disconnect leaves every scenario in this project drifting
//      under the check that posed it, at a rate that depends on how busy the
//      machine was. A second of wall time with nothing advancing the game is what
//      catches that, and the page is brought to the front first so the browser's
//      own background throttling cannot do the build's job for it.
//
// THE FIELD IS POSED FULL AND IN MOTION. Every body carries a velocity and the
// saucer arrives with all three faculties running, so ANY tick that ran would move
// something: a rock, a bullet, a saucer bullet, the saucer itself, or the
// saucer's gun putting a fresh round on the enemy roster. A held field that reads
// back identically has really held.
//
// AND THE READINGS ARE COMPARED EXACTLY. Nothing ran, so nothing was recomputed:
// `snapshot` is a pure read of stored numbers, and a build that held the clock
// reports the same bits it reported a moment ago.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseEnemyBullet,
  poseRock,
  poseSaucer,
  requireSaucer,
  startPlaying,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** How many times `advance(0)` is called before the field is read again. */
const ZERO_CALLS = 5;

/** The real milliseconds the game is left alone with its clock held. */
const WALL_MS = 1000;

/** Where the moving rock is posed, and the velocity it carries. */
const ROCK = { x: 260, y: 620, vx: 120, vy: -80 } as const;
/** Where the ship's bullet is posed, and its velocity. */
const BULLET = { x: 200, y: 180, vx: 300, vy: 120 } as const;
/** Where the saucer bullet is posed, and its velocity. */
const ENEMY_BULLET = { x: 1080, y: 180, vx: -260, vy: 140 } as const;
/** Where the saucer is brought in, 260 units clear of the star's centre. */
const SAUCER = { x: 300, y: 100 } as const;

let h: Harness;

/** Fail unless every body reads exactly where and as it did in `before`. */
function assertUnmoved(
  before: ShatterSnapshot,
  after: ShatterSnapshot,
  what: string,
): void {
  assertEqual(after.simTime, before.simTime, `${what}: simTime`);
  for (const field of ["x", "y", "vx", "vy"] as const) {
    assertEqual(
      after.ship[field],
      before.ship[field],
      `${what}: ship.${field}`,
    );
  }
  assertLength(after.rocks, before.rocks.length, `${what}: the rock roster`);
  for (const [index, rock] of before.rocks.entries()) {
    for (const field of ["x", "y", "vx", "vy"] as const) {
      assertEqual(
        after.rocks[index][field],
        rock[field],
        `${what}: rocks[${index}].${field}`,
      );
    }
  }
  assertLength(
    after.bullets,
    before.bullets.length,
    `${what}: the bullet roster`,
  );
  for (const [index, bullet] of before.bullets.entries()) {
    for (const field of ["x", "y", "life"] as const) {
      assertEqual(
        after.bullets[index][field],
        bullet[field],
        `${what}: bullets[${index}].${field}`,
      );
    }
  }
  assertLength(
    after.enemyBullets,
    before.enemyBullets.length,
    `${what}: the enemy-bullet roster`,
  );
  for (const [index, bullet] of before.enemyBullets.entries()) {
    for (const field of ["x", "y", "life"] as const) {
      assertEqual(
        after.enemyBullets[index][field],
        bullet[field],
        `${what}: enemyBullets[${index}].${field}`,
      );
    }
  }
  const wasUp = requireSaucer(before, "the posed saucer");
  const isUp = requireSaucer(after, `${what}: the saucer`);
  for (const field of ["x", "y", "vx", "vy"] as const) {
    assertEqual(isUp[field], wasUp[field], `${what}: saucer.${field}`);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the whole field through advance(0) and through real time", async () => {
  await startPlaying(h);
  await poseRock(h, "medium", ROCK.x, ROCK.y, ROCK.vx, ROCK.vy);
  await poseBullet(h, BULLET.x, BULLET.y, BULLET.vx, BULLET.vy);
  await poseEnemyBullet(
    h,
    ENEMY_BULLET.x,
    ENEMY_BULLET.y,
    ENEMY_BULLET.vx,
    ENEMY_BULLET.vy,
  );
  await poseSaucer(h, SAUCER.x, SAUCER.y);
  // One real tick, so what is held is a field the game itself has stepped rather
  // than one that has never run.
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.autoStep, false, "the clock the harness took the game off");

  // Leg 1: asking for no ticks runs no ticks.
  for (let call = 0; call < ZERO_CALLS; call += 1) {
    await h.debug.advance(0);
  }
  await captureStill(h, "held");
  assertUnmoved(posed, await h.snapshot(), `${ZERO_CALLS} x advance(0)`);

  // Leg 2: a second of real time, with the page in front so the browser is not
  // holding the build's frame loop for it.
  await h.page.bringToFront().catch(() => undefined);
  await h.page.waitForTimeout(WALL_MS);
  assertUnmoved(posed, await h.snapshot(), `${WALL_MS}ms of wall time`);
});
