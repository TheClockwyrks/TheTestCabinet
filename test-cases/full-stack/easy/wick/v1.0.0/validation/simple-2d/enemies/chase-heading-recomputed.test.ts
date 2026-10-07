// Wick — enemies/chase-heading-recomputed: a chaser re-aims at the lamplighter
// on every tick and advances one step along the heading it just computed.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Chase"): "Each tick a chasing enemy recomputes its
//     heading as the unit vector from its center to the lamplighter's center
//     and advances one step along it. The heading is recomputed every tick, so
//     a chaser turns with the lamplighter as it moves".
//   - `specs/enemies.md` ("Movement"): "one tick's step is `speed * TICK_DT`
//     units", 100 / 60 for a moth's speed of 100 ("The roster").
//   - `specs/world.md` ("One tick"): the lamplighter moves in phase 2 and the
//     enemies move in phase 4, "each reading the state the phases before it
//     left", so the heading a tick computes is toward the lamplighter's
//     position ON that tick.
//   - `specs/instrumentation.md` (`setPlayerPosition`): "Sets the lamplighter's
//     center to `(x, y)`. Nothing else moves".
//
// WHAT IS READ. Sixty ticks, each with the lamplighter posed one step further
// along its walk. After every tick the moth's `heading` is the unit vector from
// the center it held BEFORE that tick to the lamplighter's center on that tick,
// and its new center is that center plus the heading times the step. A build
// that keeps its spawn heading, that aims at where the lamplighter was a tick
// ago, or that steps a different length answers differently on almost every
// tick of the walk. The walk carries the lamplighter from one side of the moth
// to the other, so the heading turns through more than a right angle across the
// sweep, which is read as well: a build that recomputed nothing could not turn.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and nothing else, with
// `enemyMotion` the only switch on, so the only thing that moves the moth is
// its own behavior and the only thing that moves the lamplighter is the pose.
// The moth is posed 200 units above the lamplighter's line of walk and the walk
// crosses beneath it from -150 to +145, so the bearing swings through a wide
// arc while the moth closes at most 100 units. `enemyContact` stays off, so the
// two may pass close without a hit interrupting the reading.
//
// TOLERANCE. `DIRECTION_TOLERANCE` (1e-9) on each component of the heading, a
// unit vector a build normalizes with `Math.hypot` or an equivalent;
// `MOTION_TOLERANCE` (1e-6) on each component of the position, integrated tick
// by tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import {
  DIRECTION_TOLERANCE,
  ENEMIES,
  MOTION_TOLERANCE,
  TICK_DT,
} from "../constants";
import {
  angleAbout,
  angularOffset,
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  unit,
  type Harness,
  type Point,
} from "../harness";

/** The chaser this point reads: a moth, behavior `chase`, speed 100. */
const TYPE = "moth";

/** One step of the moth's speed: 100 / 60 units. */
const STEP = ENEMIES[TYPE].speed * TICK_DT;

/** How far above the walk the moth is posed. */
const MOTH_DY = -200;

/** Where the walk begins, along +x of the moth's column. */
const WALK_FROM = -150;

/** How far the lamplighter is posed along +x each tick. */
const WALK_STEP = 5;

/** How many ticks the walk runs for. */
const TICKS = 60;

/** The least the heading may turn across the walk, in degrees. */
const MIN_TURN = 45;

/** One tick of the walk: what the moth read, and where it went. */
interface Step {
  /** The moth's center before the tick. */
  from: Point;
  /** The lamplighter's center on the tick. */
  player: Point;
  /** The moth's heading after the tick. */
  heading: Point;
  /** The moth's center after the tick. */
  to: Point;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("re-aims the moth at the lamplighter every tick and steps along that heading", async () => {
  isolate(h);
  enable(h, "enemyMotion");
  const moth = spawnEnemyNear(h, TYPE, 0, MOTH_DY);
  const steps: Step[] = [];

  await captureReplay(h, "chase", async () => {
    for (let i = 0; i < TICKS; i += 1) {
      h.debug.setPlayerPosition(WALK_FROM + i * WALK_STEP, 0);
      const posed = h.snapshot();
      const was = present(enemyById(posed, moth), `the moth before tick ${i}`);
      const after = await h.tick(1);
      const now = present(enemyById(after, moth), `the moth after tick ${i}`);
      steps.push({
        from: { x: was.x, y: was.y },
        player: { x: posed.run.player.x, y: posed.run.player.y },
        heading: { x: now.heading.x, y: now.heading.y },
        to: { x: now.x, y: now.y },
      });
    }
  });

  for (const [i, step] of steps.entries()) {
    const aim = unit(step.player.x - step.from.x, step.player.y - step.from.y);
    assertWithin(
      step.heading.x,
      aim.x,
      DIRECTION_TOLERANCE,
      `tick ${i + 1}: x of the heading toward the lamplighter`,
    );
    assertWithin(
      step.heading.y,
      aim.y,
      DIRECTION_TOLERANCE,
      `tick ${i + 1}: y of the heading toward the lamplighter`,
    );
    assertWithin(
      step.to.x,
      step.from.x + aim.x * STEP,
      MOTION_TOLERANCE,
      `tick ${i + 1}: x after one step along that heading`,
    );
    assertWithin(
      step.to.y,
      step.from.y + aim.y * STEP,
      MOTION_TOLERANCE,
      `tick ${i + 1}: y after one step along that heading`,
    );
  }

  const first = steps[0];
  const last = steps[steps.length - 1];
  const turn = angularOffset(
    angleAbout({ x: 0, y: 0 }, first.heading),
    angleAbout({ x: 0, y: 0 }, last.heading),
  );
  assertGreaterThan(
    Math.abs(turn),
    MIN_TURN,
    "the degrees the heading turned across the walk",
  );
});
