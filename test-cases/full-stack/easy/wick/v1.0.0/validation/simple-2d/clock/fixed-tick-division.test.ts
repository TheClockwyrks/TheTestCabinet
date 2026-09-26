// Wick — clock/fixed-tick-division: a span of game time runs the same ticks
// however it is divided into frames.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A render-free core"): "On `playing`, each
//     frame's delta time joins the accumulator, every whole `TICK_DT` in it is
//     consumed as a tick, and the remainder waits for the next frame. A tick is
//     consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`, with
//     `TICK_EPSILON` (`1e-9`) seconds, and a remainder whose magnitude is below
//     `TICK_EPSILON` is `0`, so a frame of `0.5` seconds runs exactly `30`
//     ticks and sixty frames of `1 / 60` seconds run exactly `60`."
//   - The same section: "An interval of game time on `playing` therefore runs
//     the same ticks however it was divided into frames, and drawing advances
//     nothing."
//   - `specs/enemies.md` ("Chase"): a chaser advances "one step of `speed ×
//     TICK_DT`" toward the lamplighter every tick, and `specs/world.md` ("One
//     tick", phase 6): a projectile's "position advances by its velocity times
//     `TICK_DT`", so a moth walking in from `MOTH_X` and a bolt flying at
//     `BOLT_VY` each cover thirty steps over the span, whatever the frames.
//
// WHAT IS READ. The same isolated night is posed three times and the same half
// second of game time is delivered three ways: one frame of 0.5 s, fifty
// frames of 0.01 s, and thirty frames of one tick. Each division must leave
// `run.tick` exactly 30 higher, the moth thirty chase steps closer, and the
// bolt thirty steps along; a build that integrated with the frame's delta
// rather than the tick's lands them on three different positions.
//
// WHY THE NIGHT IS POSED AS IT IS. An empty run with nothing moving would reach
// the same figures under any division trivially, so the posed night has the
// systems running that a tick advances: a moth chasing under `enemyMotion`, a
// posed Ember bolt flying under `effectMotion`, and an attracted gem in
// flight. The director stays off so the scenario stays bounded.
//
// TOLERANCE. `INTEGRATION_TOLERANCE` (0.1) on the two integrated positions:
// thirty float steps stray by far less, and a wrong integration strays by
// whole steps. The tick count of 30 is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { ENEMIES, INTEGRATION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  present,
  projectileById,
  spawnEnemyAt,
  spawnGemAt,
  spawnProjectileAt,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The span every division delivers, in seconds: 30 ticks. */
const SPAN = 0.5;
const SPAN_TICKS = 30;

/** Where the moth starts: well clear of the lamplighter, closing at 100 u/s. */
const MOTH_X = 300;

/** The bolt: left and below the lamplighter, flying straight up. */
const BOLT_X = -100;
const BOLT_Y = 100;
const BOLT_VY = -200;

/**
 * Where the gem starts: inside the base `PICKUP_RADIUS` (48) so it is attracted
 * on the first tick and spends the span in flight toward the lamplighter.
 */
const GEM_X = 40;

/** Where the moth and the bolt stand after thirty steps. */
const MOTH_X_AFTER = MOTH_X - ENEMIES.moth.speed * TICK_DT * SPAN_TICKS;
const BOLT_Y_AFTER = BOLT_Y + BOLT_VY * TICK_DT * SPAN_TICKS;

/** One division: the ids of what was posed, and what the drive left. */
interface Division {
  moth: number;
  bolt: number;
  posed: WickSnapshot;
  after: WickSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Pose the same night afresh, run `drive` over it, and read both ends. */
async function divide(drive: () => Promise<WickSnapshot>): Promise<Division> {
  isolate(h);
  const moth = spawnEnemyAt(h, "moth", MOTH_X, 0);
  spawnGemAt(h, "small", GEM_X, 0);
  const bolt = spawnProjectileAt(h, "ember", BOLT_X, BOLT_Y, 0, BOLT_VY, 0);
  enable(h, "enemyMotion", "effectMotion");
  const posed = h.snapshot();
  const after = await drive();
  return { moth, bolt, posed, after };
}

/** Read one division against the ticks and the steps the span owes. */
function assertDivision(division: Division, what: string): void {
  assertEqual(
    division.after.run.tick - division.posed.run.tick,
    SPAN_TICKS,
    `ticks consumed by ${what}`,
  );
  const moth = present(
    enemyById(division.after, division.moth),
    `the moth after ${what}`,
  );
  assertWithin(
    moth.x,
    MOTH_X_AFTER,
    INTEGRATION_TOLERANCE,
    `the moth's x after ${what}, thirty chase steps from ${MOTH_X}`,
  );
  const bolt = present(
    projectileById(division.after, division.bolt),
    `the bolt after ${what}`,
  );
  assertWithin(
    bolt.x,
    BOLT_X,
    INTEGRATION_TOLERANCE,
    `the bolt's x after ${what}`,
  );
  assertWithin(
    bolt.y,
    BOLT_Y_AFTER,
    INTEGRATION_TOLERANCE,
    `the bolt's y after ${what}, thirty steps from ${BOLT_Y}`,
  );
}

it("runs thirty ticks from one frame, fifty frames, and thirty ticks alike", async () => {
  const divisions = await captureReplay(h, "divided", async () => {
    const one = await divide(() => h.frameOf(SPAN));
    const fifty = await divide(() => h.framesOf(SPAN / 50, 50));
    const thirty = await divide(() => h.framesOf(TICK_DT, SPAN_TICKS));
    return { one, fifty, thirty };
  });

  assertDivision(divisions.one, "one frame of 0.5 s");
  assertDivision(divisions.fifty, "fifty frames of 0.01 s");
  assertDivision(divisions.thirty, "thirty frames of TICK_DT");
});
