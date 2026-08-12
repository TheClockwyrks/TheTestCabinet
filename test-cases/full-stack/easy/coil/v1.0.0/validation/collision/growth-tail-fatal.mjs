// Automated validation for the Collision sub-item `growth-tail-fatal`.
//
// On a growth tick the tail does not retract, so the whole body — including the
// current tail cell — is solid: moving the head into the tail cell while eating there
// is fatal. This is the sibling of `tail-follow-safe` and is posed in the SAME lane
// (`tailChaseSnake`), run down the same corridor, so the pair isolates the one
// difference that decides it: whether the arriving tick is a growth tick. There it is
// normal and the head lives; here the pellet is on the corner, so the tail stays put
// and the head runs into solid body.
//
// WHY THE PELLET IS POSED IN `arrange`, NOT DROPPED ON THE CORNER MID-`act`. A revision
// of this item placed it one tick out, inside `act`, so it would sit on the corner only
// for the tick that resolves the collision. That is correct in the VALIDATE pass, where
// the build is on its manual clock and nothing moves between two calls — and it is a
// RACE in the record pass, where the build drives itself: the placement has to land
// inside a single 125 ms tick, behind a snapshot round trip and a call round trip, and
// when it misses, the tail has already stepped off the corner. The pellet then lands on
// an empty cell, the arriving tick is an ordinary one, and the clip shows the head
// safely following its tail — the exact opposite of the item's claim — while the
// verdict, decided by the exact pass, correctly reports a death. A clip that contradicts
// its own verdict is worse than no clip.
//
// Posed in `arrange` there is nothing to race: `act` holds no control op at all, and the
// death follows from the GEOMETRY (the head and the tail want the same cell on the same
// tick, see `tailChaseSnake`) rather than from hitting a window, so it lands on camera
// whenever the build's clock happens to run it.
//
// The cost is that the pellet sits on a body cell for the length of the approach, and a
// build that re-rolls a pellet it finds on the snake would move it before the head ever
// arrived — leaving a normal tick, no death, and an item that checked nothing. That is
// what the pellet guard in `assert` is for: it turns that case into a loud failure
// against the build's `setPellet` contract instead of a silent vacuous pass.
import {
  actAwait,
  actLeadIn,
  actPlayOn,
  sameCell,
  beginRound,
  tailChaseSnake,
  TAIL_CHASE_APPROACH,
  TAIL_CHASE_TARGET,
} from "../_helpers.mjs";

// The round ends on the arriving tick, so hold on the resulting game-over panel for a
// beat (8 ticks = 1 s). The round is over, so these ticks advance nothing and cannot
// move a verdict.
const HOLD_TICKS = 8;

export default function item() {
  // The state read back on the tick before the collision, and after it.
  let beforeHit;
  let s;

  return {
    id: "collision.growth-tail-fatal",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", tailChaseSnake(), "right");
      // On the corner from the start, so the arriving tick is a GROWTH tick. The head
      // does not pass over it on the way: its lane is row 8 from col 5 to col 10, and
      // the corner is col 11.
      await api.call("setPellet", TAIL_CHASE_TARGET);
    },

    async act(api) {
      // The approach: one tick short of the corner, filmed. `act` deliberately holds no
      // control op — see the header — so nothing here can miss a tick window.
      await actLeadIn(api, TAIL_CHASE_APPROACH - 1);
      beforeHit = await actAwait(api, (snap) =>
        sameCell(snap.snake[snap.snake.length - 1], TAIL_CHASE_TARGET),
      );

      await api.advance(1); // eat and enter the tail cell in the same tick — fatal
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      // Without this the death could be any death — the item is specifically about the
      // tail cell being solid on a growth tick, so the setup has to be shown to hold.
      check.expectOk(
        `the approach left the tail on the corner ${JSON.stringify(TAIL_CHASE_TARGET)}`,
        sameCell(beforeHit.snake[beforeHit.snake.length - 1], TAIL_CHASE_TARGET),
      );
      check.expectEq(
        "...and the round was still live going into it",
        beforeHit.ended,
        false,
      );
      // The pellet has to have STAYED where `arrange` put it. A build that re-rolled it
      // off the snake during the approach leaves an ordinary tick, and every death
      // assertion below would then be reporting on a scenario this item never built —
      // so catch it here, against the `setPellet` contract, rather than let it pass or
      // fail for the wrong reason.
      check.expectOk(
        `the pellet was still on the corner ${JSON.stringify(TAIL_CHASE_TARGET)}, making the arriving tick a growth tick`,
        sameCell(beforeHit.pellet, TAIL_CHASE_TARGET),
      );

      check.expectEq("the round ended", s.ended, true);
      check.expectEq("the screen is game-over", s.screen, "gameover");
      check.expectEq("the end reason is death", s.endReason, "dead");
    },
  };
}
