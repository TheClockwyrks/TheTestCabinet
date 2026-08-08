// Automated validation for the Collision sub-item `self-fatal`.
//
// The head advancing into a solid body cell ends the round immediately as a death.
// The snake is posed as a long hook (a precondition): the head at the mouth of a clear
// corridor with its own flank closing the far end. It runs that corridor down and, on
// the arriving tick, advances into the flank.
//
// The pose is instant (`arrange`); the approach and the fatal tick are `act`, so the
// clip opens on the snake in its corridor and a reviewer watches it close on its own
// body. The run-in is part of the CHECKED scenario rather than a preamble staged in
// front of it — the head reaches the flank BECAUSE of it — which is the rule the
// sibling `wall-fatal` was rewritten under.
//
// The flank cell is deliberately deep in the body, not the tail: the tail retracts one
// cell a tick during the approach, and a head arriving at a cell the tail is leaving is
// the SAFE tail-follow of the sibling item, not a self-collision. Eight cells of chain
// sit behind the flank cell when the head gets there, so it is unambiguously solid.
import {
  actLeadIn,
  actPlayOn,
  actAwait,
  beginRound,
  onSnake,
  PARK_PELLET,
} from "../_helpers.mjs";

// The corridor the head runs and the cell that closes it. The head is posed at col 4
// and the flank sits at col 12, so it takes EIGHT ticks to reach — seven of approach,
// filmed, and the eighth being the collision itself.
const FLANK = { col: 12, row: 8 };
const HEAD_START_COL = 4;
const APPROACH_TICKS = FLANK.col - HEAD_START_COL; // 8; the last one is the collision

// The round ends on the arriving tick; hold on the game-over panel for a beat (8 ticks
// = 1 s) so the clip is readable. The round is over, so these ticks advance nothing.
const HOLD_TICKS = 8;

/**
 * The hook: head at (4,8) facing right down a clear row-8 corridor, the body dropping
 * to row 9, running out past the corridor's end, turning up at col 12 — which puts
 * `FLANK` in the head's path — and returning along row 7. Rows 7-9 over cols 4-12
 * carry no Maze obstacle, so the pose is clear in both variants.
 */
function hookSnake() {
  const cells = [{ col: HEAD_START_COL, row: 8 }]; // head
  for (let c = 4; c <= 12; c += 1) cells.push({ col: c, row: 9 }); // out along row 9
  cells.push({ col: 12, row: 8 }); // FLANK — the cell the head runs into
  cells.push({ col: 12, row: 7 });
  for (let c = 11; c >= 4; c -= 1) cells.push({ col: c, row: 7 }); // back along row 7
  return cells;
}

export default function item() {
  // The state read back on the tick before the collision, and after it.
  let beforeHit;
  let s;

  return {
    id: "collision.self-fatal",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hookSnake(), "right");
      await api.call("setPellet", PARK_PELLET); // far away — every tick here is normal
    },

    async act(api) {
      // The approach: one tick short of the flank, filmed.
      await actLeadIn(api, APPROACH_TICKS - 1);
      beforeHit = await actAwait(
        api,
        (snap) => snap.snake[0].col >= FLANK.col - 1,
      );

      await api.advance(1); // the tick that runs the head into its own body
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      // A death only means what this item says it means if the cell the head entered
      // was its own body at the time — otherwise the round could have ended for some
      // entirely different reason and this would still read as a pass.
      check.expectOk(
        `the flank cell ${JSON.stringify(FLANK)} was still solid body going into the tick`,
        onSnake(FLANK, beforeHit.snake),
      );
      check.expectEq(
        "...and the round was still live",
        beforeHit.ended,
        false,
      );

      check.expectEq("the round ended", s.ended, true);
      check.expectEq("the screen is game-over", s.screen, "gameover");
      check.expectEq("the end reason is death", s.endReason, "dead");
    },
  };
}
