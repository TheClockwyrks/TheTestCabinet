// sconce/returns-past-launch-point — a sconce comes back through the point it
// was launched from, wherever the lamplighter has walked to since.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): the sconce
// "reverses once `speed / SCONCE_DECEL` seconds of motion have passed and
// returns past the launch point, which stays where the player's center was on
// the tick of firing". The threshold is the launch point itself: the sconce's
// offset along `d` from it is positive while the sconce is outbound and
// negative once it has returned past it.
//
// WHICH TICKS ARE READ. Summing the per-tick step the same section fixes,
// `(speed − SCONCE_DECEL × k × TICK_DT) × TICK_DT` on tick `k + 1`, puts a
// level-1 sconce at `+10` units after 120 moving ticks, back on the launch
// point after 121, and `10.166…` units past it after 122. So the outbound
// reading is taken on the first moving tick and the returned reading on tick
// 122, by which a build honoring the rule is well past the point. Its
// `duration` of 2.5 seconds makes its `ttl` 150 ticks (`specs/world.md`,
// Timers), so tick 122 falls inside its life: it is removed on tick 150, not
// before, which is what "before its ttl is due" asks for.
//
// WHY THE LAMPLIGHTER IS WALKED AWAY. The launch point "stays where the
// player's center was on the tick of firing", so it is a point of the world
// and not a point of the lamplighter. The lamplighter is posed 400 units
// across the launch direction right after the firing, so a build that carried
// the return point along with the lamplighter never brings the sconce back
// past the point read here, while one that fixed it in the world does.
//
// WHY THE FIRING IS REAL AND NOT POSED. Only a firing has a launch point; a
// posed sconce is placed at a point the check named. So Sconce is held and
// armed, and the launch point is read off the lamplighter's center on the tick
// that fired.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth to aim at,
// Sconce at level 1 armed, and nothing else. After the firing tick the moth is
// cleared, so nothing is in the sconce's path to hit; `weaponFire` goes off,
// so the 2-second cooldown does not launch a second sconce on tick 120 of the
// flight; and `effectMotion` goes on, so "the sconces decelerate"
// (`specs/world.md`, phase 6) and nothing else runs.
//
// THE TOLERANCE. The threshold is `0`, the launch point, and the spec's own
// figures clear it by ten units in each direction: `+10` on the first moving
// tick and `−10.166…` on tick 122. Exactly where along `d` the sconce sits on
// a given tick is `integration-order`'s and `decelerates`' point, so the
// readings here are held to the side of the launch point they fall on rather
// than to a distance, and a build whose sconce flies on without turning, or
// turns around some other point, is tens to hundreds of units the wrong side.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  disable,
  enable,
  projectileById,
  type Harness,
  type SnapshotProjectile,
} from "../harness";
import { fireSconce, LAUNCH_DIRECTION, TARGET_POSTS } from "./firing";
import { along } from "./flight";

/** Level 1 of Sconce: speed 600, duration 2.5, amount 1. */
const LEVEL = 1;

/** The one moth, at `(300, 400)` from the lamplighter's center. */
const POSTS = TARGET_POSTS.slice(0, 1);

/** The tick the sconce is read outbound on, and the one it is read returned on. */
const OUT_TICK = 1;
const PAST_TICK = 122;

/** How far across the launch direction the lamplighter is posed after the firing. */
const WALK = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries the sconce out and back past the launch point while its ttl still runs", async () => {
  const firing = await fireSconce(h, LEVEL, POSTS);
  if (firing.sconces.length !== 1) {
    throw new Error(
      `Expected: one sconce launched at level ${LEVEL} (specs/weapons.md, Sconce)\nActual: ${firing.sconces.length}`,
    );
  }
  const id = firing.sconces[0].id;

  // The launch point: the lamplighter's center on the tick that fired.
  const launch = {
    x: firing.after.run.player.x,
    y: firing.after.run.player.y,
  };

  // Walk the lamplighter across the launch direction, and leave the sconce
  // alone in the world with nothing but its own motion running.
  h.debug.clearEnemies();
  disable(h, "weaponFire");
  h.debug.setPlayerPosition(
    launch.x - WALK * LAUNCH_DIRECTION.y,
    launch.y + WALK * LAUNCH_DIRECTION.x,
  );
  enable(h, "effectMotion");

  const read = (tick: number): SnapshotProjectile => {
    const sconce = projectileById(h.snapshot(), id);
    if (sconce === undefined) {
      throw new Error(
        `Expected: the sconce still in the world after ${tick} moving ticks, its ttl of 2.5 seconds being 150 (specs/weapons.md, Sconce)\nActual: gone`,
      );
    }
    return sconce;
  };

  const trace = await captureReplay(h, "return", async () => {
    await advanceTicks(h, OUT_TICK);
    const out = read(OUT_TICK);
    await advanceTicks(h, PAST_TICK - OUT_TICK);
    return { out, past: read(PAST_TICK) };
  });

  assertGreaterThan(
    along(trace.out.x - launch.x, trace.out.y - launch.y, LAUNCH_DIRECTION),
    0,
    `the sconce's offset along d from the launch point after ${OUT_TICK} moving tick, outbound (specs/weapons.md, Sconce)`,
  );
  assertLessThan(
    along(trace.past.x - launch.x, trace.past.y - launch.y, LAUNCH_DIRECTION),
    0,
    `the same offset after ${PAST_TICK} moving ticks, past the launch point (specs/weapons.md, Sconce)`,
  );
});
