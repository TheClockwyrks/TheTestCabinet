// Wick — clock/fixed-tick-division: a span of game time reaches the same
// state however it is divided into frames.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A deterministic core"): "The simulation
//     advances only in whole ticks of `TICK_DT` (`1 / 60`) seconds ... On
//     `playing`, each frame's delta time joins the accumulator, every whole
//     `TICK_DT` in it is consumed as a tick, and the remainder waits for the
//     next frame ... so a frame of `0.5` seconds runs exactly `30` ticks and
//     sixty frames of `1 / 60` seconds run exactly `60`. ... An interval of
//     game time on `playing` therefore reaches the same state however it was
//     divided into frames, and drawing advances nothing."
//   - The same file: "Given the same seed, the same sequence of operations, and
//     the same number of ticks, the game reaches the same `run` and `rngState`
//     every time."
//   - `specs/instrumentation.md` ("What the runtime provides instead"): "a
//     clock of any other length poses a partial frame. `simTime` and
//     `accumulator` behave under such a clock exactly as under the wall clock."
//
// THE DRIVE. One isolated run is posed three times from the same seed with the
// same operations, and half a second is delivered to each in a different
// division: one frame of 500 ms, fifty frames of 10 ms, and thirty frames of
// `TICK_MS`. Each must leave `run.tick` thirty higher and the same `run` and
// `rngState`. The world is posed so that ticks DO something the divisions
// could disagree on: a moth chasing under `enemyMotion`, Ember armed under
// `weaponFire` and `effectMotion` so its bolt is fired and flies, and the
// director on under `spawning` so its first-tick spawn draws from the seeded
// generator and `rngState` moves. The frames of 10 ms are the interesting
// division: no frame is a whole tick, so every tick is assembled from parts.
//
// TOLERANCE. None: the specification promises the SAME `run` and `rngState`,
// because a tick is a function of the state alone and the frame that carried it
// never enters the arithmetic. `run` is compared structurally, and the tick
// count exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ, TICK_MS } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  placeEnemy,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The seed every division is posed from. */
const SEED = 7;

/** The span delivered, in seconds, and the ticks it is worth. */
const SPAN_SECONDS = 0.5;
const SPAN_TICKS = SPAN_SECONDS * TICK_HZ;

/** The fifty small frames, in milliseconds each. */
const SMALL_FRAME_MS = 10;
const SMALL_FRAMES = (SPAN_SECONDS * 1000) / SMALL_FRAME_MS;

/** Where the moth is posed: Ember's target, chasing at 100 units/s. */
const MOTH_X = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The one posed run every division starts from. */
function pose(): WickSnapshot {
  isolate(h, { seed: SEED });
  placeEnemy(h, "moth", MOTH_X, 0);
  const ember = holdWeapon(h, "ember", 1);
  armWeapon(h, ember);
  enable(h, "enemyMotion", "effectMotion", "spawning");
  return h.snapshot();
}

it("reaches the same state from one frame, fifty frames, and thirty ticks", async () => {
  const divided = await captureReplay(h, "divided", async () => {
    const startOne = pose();
    const one = await h.frameOf(SPAN_SECONDS * 1000);

    const startFifty = pose();
    let fifty = startFifty;
    for (let frame = 0; frame < SMALL_FRAMES; frame += 1) {
      fifty = await h.frameOf(SMALL_FRAME_MS);
    }

    const startThirty = pose();
    const thirty = await advanceTicks(h, SPAN_TICKS);

    return { startOne, one, startFifty, fifty, startThirty, thirty };
  });

  // The three poses are the same run: the divisions start from one state.
  assertDeepEqual(
    divided.startFifty.run,
    divided.startOne.run,
    "the posed run before the fifty small frames, against the first pose",
  );
  assertDeepEqual(
    divided.startThirty.run,
    divided.startOne.run,
    "the posed run before the thirty ticks, against the first pose",
  );
  const startTick = divided.startOne.run.tick;

  assertEqual(
    divided.one.run.tick,
    startTick + SPAN_TICKS,
    "run.tick after one frame of 0.5 s",
  );
  assertEqual(
    divided.fifty.run.tick,
    startTick + SPAN_TICKS,
    "run.tick after fifty frames of 0.01 s",
  );
  assertEqual(
    divided.thirty.run.tick,
    startTick + SPAN_TICKS,
    `run.tick after thirty frames of ${TICK_MS} ms`,
  );

  assertDeepEqual(
    divided.fifty.run,
    divided.one.run,
    "the run after fifty frames of 0.01 s, against one frame of 0.5 s",
  );
  assertDeepEqual(
    divided.thirty.run,
    divided.one.run,
    "the run after thirty frames of TICK_DT, against one frame of 0.5 s",
  );
  assertEqual(
    divided.fifty.rngState,
    divided.one.rngState,
    "rngState after fifty frames of 0.01 s, against one frame of 0.5 s",
  );
  assertEqual(
    divided.thirty.rngState,
    divided.one.rngState,
    "rngState after thirty frames of TICK_DT, against one frame of 0.5 s",
  );
});
