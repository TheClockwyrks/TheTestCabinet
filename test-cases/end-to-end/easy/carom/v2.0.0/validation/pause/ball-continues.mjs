// Automated validation for the Pause sub-item `ball-continues`: after unpausing, the
// ball carries on from exactly where it was suspended — same position, same velocity
// — rather than teleporting to a fresh spot (a re-serve or a jump back to center).
//
// A live ball is posed mid-flight and allowed to travel, then the game is paused. The
// ball is confirmed frozen, then the game is resumed and stepped a single tick: the
// ball must be exactly one step's travel on from where it was paused, at its
// preserved velocity. A build that re-centered or re-served the ball on resume lands
// far from that continuation and fails. See validation/_helpers.mjs.

import { arrangeLiveBall, TICK_HZ, ball0 } from "../_helpers.mjs";

export default function item() {
  let paused;
  let stillPaused;
  let resumed;

  return {
    id: "pause.ball-continues",

    // A live match with the ball posed mid-flight, clear of the obstacles so a single
    // resumed step is a clean straight advance.
    async arrange(api) {
      await arrangeLiveBall(api, { x: 500, y: 360, vx: 400, vy: -120 });
    },

    // Fly, pause, confirm frozen, resume, and take one live step. The whole sequence
    // IS the clip: the ball moves, freezes, then picks up exactly where it left off.
    async act(api) {
      await api.advance(30); // 0.25 s of visible flight
      await api.call("press", "Escape");
      paused = ball0(await api.snapshot());
      await api.advance(120); // 1 s paused
      stillPaused = ball0(await api.snapshot());
      await api.call("press", "Escape"); // resume
      await api.advance(1); // a single live step
      resumed = ball0(await api.snapshot());
      // A tail so the clip shows the ball flying on, not the single resumed frame.
      await api.advance(72);
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

      // One resumed step advances the ball by exactly its velocity — no teleport.
      check.expectClose(
        "the resumed ball continues from its paused position (x)",
        resumed.x,
        paused.x + paused.vx / TICK_HZ,
        2,
      );
      check.expectClose(
        "the resumed ball continues from its paused position (y)",
        resumed.y,
        paused.y + paused.vy / TICK_HZ,
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
