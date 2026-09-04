// Wick — clock/fixed-tick-division: a span of game time reaches the same state
// however it is divided into frames.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A deterministic core"): "On `playing`, each
//     frame's delta time joins the accumulator, every whole `TICK_DT` in it is
//     consumed as a tick, and the remainder waits for the next frame. A tick is
//     consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`, with
//     `TICK_EPSILON` (`1e-9`) seconds, and a remainder whose magnitude is below
//     `TICK_EPSILON` is `0`, so a frame of `0.5` seconds runs exactly `30`
//     ticks and sixty frames of `1 / 60` seconds run exactly `60`."
//   - The same section: "An interval of game time on `playing` therefore
//     reaches the same state however it was divided into frames, and drawing
//     advances nothing."
//   - The same file: "Given the same seed, the same sequence of operations, and
//     the same number of ticks, the game reaches the same `run` and `rngState`
//     every time. `simTime` and `muted` stand outside that".
//
// WHAT IS READ. The same isolated night is posed three times from the same seed
// and the same half second of game time is delivered three ways: one frame of
// 0.5 s, fifty frames of 0.01 s, and thirty frames of one tick. Each division
// must leave `run.tick` exactly 30 higher, and the three must leave the same
// `run` and the same `rngState`, field for field. `simTime` and `accumulator`
// are left out of the comparison, as the spec itself leaves `simTime` outside
// determinism and the remainder belongs to the accumulator points.
//
// WHY THE NIGHT IS POSED AS IT IS. An empty run with nothing moving would reach
// the same state under any division trivially, so the posed night has the
// systems running that a tick advances: a moth chasing under `enemyMotion`, a
// held Oil Splash under `weaponFire` whose landing point draws from the seeded
// generator on its firing tick, a held Ember whose bolt flies under
// `effectMotion`, and an attracted gem in flight. The director stays off so the
// scenario stays bounded; a build that advanced any of these per frame rather
// than per tick would differ between the divisions.
//
// TOLERANCE. None: the spec states the three divisions reach the same state,
// and `run` is compared structurally. The frame counts are exact by the
// spec's own worked example, and the tick count of 30 is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  spawnGemAt,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The seed every division starts from; any whole number would do. */
const SEED = 7;

/** The span every division delivers, in seconds: 30 ticks. */
const SPAN = 0.5;
const SPAN_TICKS = 30;

/** Where the moth starts: well clear of the lamplighter, closing at 100 u/s. */
const MOTH_X = 300;

/**
 * Where the gem starts: inside the base `PICKUP_RADIUS` (48) so it is attracted
 * on the first tick and spends the span in flight toward the lamplighter.
 */
const GEM_X = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Pose the same night from the same seed: what every division starts from. */
function poseNight(): WickSnapshot {
  isolate(h, { seed: SEED });
  spawnEnemyAt(h, "moth", MOTH_X, 0);
  spawnGemAt(h, "small", GEM_X, 0);
  holdWeapon(h, "oil-splash");
  holdWeapon(h, "ember");
  enable(h, "enemyMotion", "weaponFire", "effectMotion");
  return h.snapshot();
}

it("reaches the same state from one frame, fifty frames, and thirty ticks", async () => {
  const outcomes = await captureReplay(h, "divided", async () => {
    const one = poseNight();
    const asOne = await h.frameOf(SPAN);

    const fifty = poseNight();
    const asFifty = await h.framesOf(SPAN / 50, 50);

    const thirty = poseNight();
    const asThirty = await h.framesOf(TICK_DT, SPAN_TICKS);

    return { one, asOne, fifty, asFifty, thirty, asThirty };
  });

  // Every division starts from the same posed run and generator state.
  assertDeepEqual(outcomes.fifty.run, outcomes.one.run, "the posed run");
  assertEqual(outcomes.fifty.rngState, outcomes.one.rngState, "posed rngState");
  assertDeepEqual(outcomes.thirty.run, outcomes.one.run, "the posed run");
  assertEqual(
    outcomes.thirty.rngState,
    outcomes.one.rngState,
    "posed rngState",
  );

  assertEqual(
    outcomes.asOne.run.tick - outcomes.one.run.tick,
    SPAN_TICKS,
    "ticks consumed by one frame of 0.5 s",
  );
  assertEqual(
    outcomes.asFifty.run.tick - outcomes.fifty.run.tick,
    SPAN_TICKS,
    "ticks consumed by fifty frames of 0.01 s",
  );
  assertEqual(
    outcomes.asThirty.run.tick - outcomes.thirty.run.tick,
    SPAN_TICKS,
    "ticks consumed by thirty frames of TICK_DT",
  );

  assertDeepEqual(
    outcomes.asFifty.run,
    outcomes.asOne.run,
    "run after fifty frames of 0.01 s against one frame of 0.5 s",
  );
  assertEqual(
    outcomes.asFifty.rngState,
    outcomes.asOne.rngState,
    "rngState after fifty frames of 0.01 s against one frame of 0.5 s",
  );
  assertDeepEqual(
    outcomes.asThirty.run,
    outcomes.asOne.run,
    "run after thirty frames of TICK_DT against one frame of 0.5 s",
  );
  assertEqual(
    outcomes.asThirty.rngState,
    outcomes.asOne.rngState,
    "rngState after thirty frames of TICK_DT against one frame of 0.5 s",
  );
});
