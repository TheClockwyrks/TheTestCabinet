// Automated validation for the Collision sub-item `growth-tail-fatal`.
//
// On a growth tick the tail does not retract, so the whole body — including the
// current tail cell — is solid: moving the head into the tail cell while eating there
// is fatal. The same loop the tail-follow check uses is posed, but with the pellet ON
// the tail cell so the tick is a GROWTH tick (a precondition); one real tick resolves
// it and the outcome is read back — this time the round must end as a death.
//
// The pose is instant, so it is `arrange`; the single fatal tick is the only timed
// part, so it is the clip — the very collision the assertions score, rather than the
// separate scenario the old clip tail re-posed.

import { actPlayOn, beginRound } from "../_helpers.mjs";

// The round ends on the very first tick, so the clip would otherwise be one 125 ms
// flicker. Hold on the resulting game-over panel for a beat (8 ticks = 1 s). The round
// is over, so these ticks advance nothing and cannot move a verdict.
const HOLD_TICKS = 8;

export default function item() {
  // The state `act` read back after the fatal tick, checked by `assert`.
  let s;

  return {
    id: "collision.growth-tail-fatal",

    async arrange(api) {
      await beginRound(api);
      // Same loop as tail-follow: head at (10,8) facing right steps into the tail (11,8).
      const snake = [
        { col: 10, row: 8 },
        { col: 10, row: 9 },
        { col: 11, row: 9 },
        { col: 11, row: 8 }, // tail
      ];
      await api.call("setSnake", snake, "right");
      // Pellet ON the tail cell (11,8) — the head's target — so this is a GROWTH tick and
      // the tail does not vacate: entering it is fatal.
      await api.call("setPellet", { col: 11, row: 8 });
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
