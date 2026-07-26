// Automated validation for the Collision sub-item `self-fatal`.
//
// The head advancing into a solid body cell ends the round immediately as a death.
// The snake is posed as a small loop whose head, on the next tick, advances into one
// of its own body cells (a precondition); one real tick resolves the collision and
// the end state is read back.
//
// The pose is instant (`arrange`); the single fatal tick is the only timed part, so
// the clip IS the self-collision the assertions score.

import { actPlayOn, beginRound } from "../_helpers.mjs";

// The death lands on the first tick; hold on the game-over panel for a beat (8 ticks
// = 1 s) so the clip is readable. The round is over, so these ticks advance nothing.
const HOLD_TICKS = 8;

export default function item() {
  // The state `act` read back after the fatal tick, checked by `assert`.
  let s;

  return {
    id: "collision.self-fatal",

    async arrange(api) {
      await beginRound(api);
      // Facing down, the head at (10,8) advances into (10,9), which is a body cell.
      const snake = [
        { col: 10, row: 8 }, // head; steps down into (10,9)
        { col: 11, row: 8 },
        { col: 11, row: 9 },
        { col: 10, row: 9 }, // the body cell the head runs into
        { col: 9, row: 9 },
        { col: 9, row: 8 }, // tail (would vacate on a normal tick, but is not the target)
      ];
      await api.call("setSnake", snake, "down");
      await api.call("setPellet", { col: 5, row: 1 }); // far away — a normal (non-growth) tick
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT)
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the round ended", s.ended, true);
      check.expectEq("the screen is game-over", s.screen, "gameover");
      check.expectEq("the end reason is death", s.endReason, "dead");
    },
  };
}
