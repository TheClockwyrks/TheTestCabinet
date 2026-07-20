// Automated validation for the Collision sub-item `tail-follow-safe`.
//
// On a normal (non-growth) tick the head may safely enter the cell the tail is
// vacating that tick, so the snake can chase its own tail without dying. The snake is
// posed as a loop whose head, on a normal tick, advances into the current tail cell
// (a precondition); one real tick resolves it and the outcome is read back — the
// round must NOT end, and the head must have taken the old tail cell.

import { TICK_DT, sameCell, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("collision.tail-follow-safe");

  await beginRound(api);
  // Facing right, the head at (10,8) advances into (11,8), which is the CURRENT tail.
  const snake = [
    { col: 10, row: 8 }, // head; steps right into (11,8)
    { col: 10, row: 9 },
    { col: 11, row: 9 },
    { col: 11, row: 8 }, // tail — vacates this tick, so the head may safely follow
  ];
  await api.call("setSnake", snake, "right");
  await api.call("setPellet", { col: 5, row: 1 }); // far away — a normal (non-growth) tick

  await api.step(TICK_DT);
  const s = await api.snapshot();

  check.expectEq("the round did NOT end (tail-follow is safe)", s.ended, false);
  check.expectEq("the screen is still playing", s.screen, "playing");
  check.expectOk(
    "the head took the old tail cell (11,8)",
    sameCell(s.snake[0], { col: 11, row: 8 }),
  );
  check.expectEq("the snake did not grow", s.length, 4);

  await liveClip(api, { snake, dir: "right", pellet: { col: 5, row: 1 }, ms: 800 });
  return check.verdict();
}
