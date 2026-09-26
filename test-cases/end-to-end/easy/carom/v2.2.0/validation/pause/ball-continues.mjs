// Automated validation for the Pause sub-item `ball-continues`: after unpausing, the
// ball carries on from exactly where it was suspended — same position, same velocity
// — rather than teleporting to a fresh spot (a re-serve or a jump back to center).
//
// A live ball is posed mid-flight and allowed to travel, then the game is paused. The
// ball is confirmed frozen, then the game is resumed and stepped a short way on: the
// ball must be exactly that much of its preserved velocity on from where it was
// paused. A build that re-centered or re-served the ball on resume lands far from that
// continuation, and one that never resumed at all has not moved from it, so both fail.
// See validation/_helpers.mjs.

import {
  arrangeLiveBall,
  resumeWithKeys,
  TICK_HZ,
  ball0,
} from "../_helpers.mjs";

// How far the resumed ball is carried before it is read. The posed flight travels
// 3.33 px per tick horizontally and 1 px vertically, so a single tick moves the ball
// less than the tolerances the readings are compared within — a ball that never
// resumed at all would sit inside them on both axes. Reading 12 ticks on puts a
// continued ball 40 px and 12 px from where it was suspended, an order of magnitude
// clear of the tolerance either way, while still landing well short of the obstacles
// (x 480-500 and 780-800) and the walls, so the continuation stays the straight line
// the assertions predict.
const RESUMED_TICKS = 12;

// The horizontal tolerance, in px. Nothing pins whether the frame that reads the resume
// key also integrates, so a build that drains its input after the update is one 3.33 px
// tick behind one that drains before it, and both are conformant. 5 px covers that tick
// and leaves the discriminations untouched: a ball that never resumed is 40 px adrift,
// and a re-served one — which lands at x 640, all but exactly where a continued ball
// does — is told apart on y and speed rather than here.
const X_TOL = 5;

export default function item() {
  let paused;
  let stillPaused;
  let resumed;

  return {
    id: "pause.ball-continues",

    // A live match with the ball posed mid-flight, clear of the obstacles so the
    // resumed stretch is a clean straight advance.
    async arrange(api) {
      await arrangeLiveBall(api, { x: 500, y: 360, vx: 400, vy: -120 });
    },

    // Fly, pause, confirm frozen, resume, and run on live. The whole sequence
    // IS the clip: the ball moves, freezes, then picks up exactly where it left off.
    async act(api) {
      await api.advance(30); // 0.25 s of visible flight
      await api.call("press", "Escape");
      paused = ball0(await api.snapshot());
      await api.advance(120); // 1 s paused
      stillPaused = ball0(await api.snapshot());
      await resumeWithKeys(api); // resume through the pause menu
      await api.advance(RESUMED_TICKS);
      resumed = ball0(await api.snapshot());
      // A tail so the clip shows the ball flying on, not the frame it restarted from.
      await api.advance(61); // out to the same 73 ticks the resumed flight always filmed
    },

    async assert(api, check) {
      // The ball truly hung still while paused (so "continues" means from the paused
      // spot, not from wherever a still-running sim would have carried it).
      check.expectClose(
        "the ball stayed put while paused (x)",
        stillPaused.x,
        paused.x,
        1,
      );
      check.expectClose(
        "the ball stayed put while paused (y)",
        stillPaused.y,
        paused.y,
        1,
      );

      // The resumed steps carry the ball exactly its preserved velocity's worth on
      // from where it hung — no teleport, and no stall.
      check.expectClose(
        "the resumed ball continues from its paused position (x)",
        resumed.x,
        paused.x + (paused.vx * RESUMED_TICKS) / TICK_HZ,
        X_TOL,
      );
      check.expectClose(
        "the resumed ball continues from its paused position (y)",
        resumed.y,
        paused.y + (paused.vy * RESUMED_TICKS) / TICK_HZ,
        2,
      );
      check.expectClose(
        "the resumed ball keeps its velocity (speed)",
        resumed.speed,
        paused.speed,
        2,
      );
    },
  };
}
