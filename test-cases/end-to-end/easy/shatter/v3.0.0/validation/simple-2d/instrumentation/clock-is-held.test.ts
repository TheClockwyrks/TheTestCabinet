// instrumentation/clock-is-held — nothing advances unless a step asks it to.
//
// TWO LEGS, AND EACH NAMES A DIFFERENT WRONG MODEL.
//
//   1. ASKING FOR NO FRAMES RUNS NOTHING. `engine.advance(0)` runs no frame, so the
//      build's `update` is never reached and the field must read back exactly as it
//      stood. What this catches is a build that moved the game from somewhere other
//      than its own `update` — a timer of its own, a `requestAnimationFrame` it
//      started, a body stepped inside a debug operation. `specs/instrumentation.md`
//      puts the clock with the engine under this engine, and `specs/simulation.md`
//      makes the game advance "from the elapsed time the game is handed" and from
//      nothing else, so a build with a second source of motion is wrong, and every
//      scenario in this project that poses a state and then reads it back before
//      driving it would be reading a state that had already moved.
//   2. READING THE GAME DOES NOT MOVE IT. `specs/instrumentation.md` makes
//      `snapshot()` "a pure read of the state" that "changes nothing", and this
//      project reads the game through it hundreds of times per scenario. A
//      `snapshot` that stepped a timer, consumed a queue, or reseeded the generator
//      on its way past would make every one of those readings a different reading
//      from the one before it. So the same field is read many times over and the
//      last reading is held against the first, exactly.
//
// THE FIELD IS POSED FULL AND IN MOTION. Every body carries a velocity and the
// saucer arrives with all three faculties running, so ANY tick that ran would move
// something: a rock, a bullet, a saucer bullet, the saucer itself, or the saucer's
// gun putting a fresh round on the enemy roster. A held field that reads back
// identically has really held.
//
// AND THE READINGS ARE COMPARED EXACTLY. Nothing ran, so nothing was recomputed:
// `snapshot` reports stored numbers, and a build that held reports the same bits it
// reported a moment ago.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseEnemyBullet,
  poseRock,
  poseSaucer,
  startPlaying,
  theSaucer,
  type Harness,
} from "../harness";
import type { ShatterSnapshot } from "../surface";

/** How many times each of the two no-op calls is made before the field is reread. */
const REPEATS = 5;

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
  const wasUp = theSaucer(before, "the posed saucer");
  const isUp = theSaucer(after, `${what}: the saucer`);
  for (const field of ["x", "y", "vx", "vy"] as const) {
    assertEqual(isUp[field], wasUp[field], `${what}: saucer.${field}`);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the whole field through advance(0) and through repeated reads", async () => {
  startPlaying(h);
  poseRock(h, "medium", ROCK.x, ROCK.y, ROCK.vx, ROCK.vy);
  poseBullet(h, BULLET.x, BULLET.y, BULLET.vx, BULLET.vy);
  poseEnemyBullet(
    h,
    ENEMY_BULLET.x,
    ENEMY_BULLET.y,
    ENEMY_BULLET.vx,
    ENEMY_BULLET.vy,
  );
  poseSaucer(h, SAUCER.x, SAUCER.y);
  // One real frame, so what is held is a field the game itself has stepped rather
  // than one that has never run.
  await h.advance(1);
  captureStill(h, "held");

  const posed = h.snapshot();

  // Leg 1: asking for no frames runs no frames.
  for (let call = 0; call < REPEATS; call += 1) await h.advance(0);
  assertUnmoved(posed, h.snapshot(), `${REPEATS} x advance(0)`);

  // Leg 2: reading the game does not move it.
  for (let read = 0; read < REPEATS; read += 1) h.snapshot();
  assertUnmoved(posed, h.snapshot(), `${REPEATS + 2} x snapshot()`);
});
