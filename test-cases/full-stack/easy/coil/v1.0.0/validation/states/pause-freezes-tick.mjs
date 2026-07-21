// Automated validation for the Game States sub-item `pause-freezes-tick`.
//
// While the game is paused the simulation does not advance: the snake, its head cell,
// and the tick count do not change. A round is run a little, paused, then far more
// than a couple of seconds is let pass — nothing must advance and the screen must stay
// paused.
//
// This item is the one place where the old "live clip" tail carried REAL assertions
// rather than being a re-posed demo: it handed the clock back and waited 1200 ms of
// wall time to prove real time does not advance a paused tick either. Under the
// two-pass runtime that is simply a third `advance` in the same `act` — the validate
// pass proves it with instant simulation time, the record pass proves it visually with
// real time, from one piece of code. Both freeze assertions are kept verbatim.

import { hLane, PARK_PELLET, sameCell, beginRound } from "../_helpers.mjs";

// One second of live play before the pause. The old step(1.0) was SECONDS; at 8 Hz
// that is exactly 8 ticks, and the assertion still reads "the round advanced before
// pausing" against a tick count of 8.
const RUN_TICKS = 8;

// Two seconds of paused time. The old step(2.0) → 16 ticks exactly.
const PAUSED_SIM_TICKS = 16;

// The old tail waited 1200 ms of real time. At 125 ms a tick that is 9.6 ticks, which
// the tick contract refuses rather than rounds. Round UP to 10 (1250 ms): this is a
// "let plenty of time pass and prove nothing moved" duration, so a longer wait only
// strengthens it, where rounding down would shorten the very thing being demonstrated.
const PAUSED_REAL_TICKS = 10;

export default function item() {
  // The state while running, the screen right after the pause, and the two states read
  // after time was allowed to pass while paused.
  let running;
  let pausedScreen;
  let afterStep;
  let afterLive;

  return {
    id: "states.pause-freezes-tick",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(8, 8, 3), "right");
      await api.call("setPellet", PARK_PELLET);
    },

    async act(api) {
      await api.advance(RUN_TICKS); // run one second -> 8 ticks
      running = await api.snapshot();

      await api.call("press", "Escape"); // pause
      pausedScreen = (await api.snapshot()).screen;

      await api.advance(PAUSED_SIM_TICKS); // two seconds of time while paused
      afterStep = await api.snapshot();

      // And plenty more on top. In the record pass this is 1.25 s of real time with the
      // build driving its own clock — the visual proof the old live clip provided.
      await api.advance(PAUSED_REAL_TICKS);
      afterLive = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the round advanced before pausing", running.ticks, 8);
      check.expectEq("the game is paused", pausedScreen, "paused");

      check.expectEq(
        "the tick count did not advance while paused",
        afterStep.ticks,
        running.ticks,
      );
      check.expectOk(
        "the head did not move while paused",
        sameCell(afterStep.snake[0], running.snake[0]),
      );
      check.expectEq("the screen is still paused", afterStep.screen, "paused");

      check.expectEq(
        "real time also does not advance the tick while paused",
        afterLive.ticks,
        running.ticks,
      );
      check.expectEq(
        "still paused after real time passed",
        afterLive.screen,
        "paused",
      );
    },
  };
}
