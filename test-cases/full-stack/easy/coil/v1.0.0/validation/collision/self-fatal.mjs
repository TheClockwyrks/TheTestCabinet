// Automated validation for the Collision sub-item `self-fatal`.
//
// The head advancing into a solid body cell ends the round immediately as a death.
// The snake is posed as a small loop whose head, on the next tick, advances into one
// of its own body cells (a precondition); one real tick resolves the collision and
// the end state is read back.

import { TICK_DT, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("collision.self-fatal");

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

  await api.step(TICK_DT);
  const s = await api.snapshot();

  check.expectEq("the round ended", s.ended, true);
  check.expectEq("the screen is game-over", s.screen, "gameover");
  check.expectEq("the end reason is death", s.endReason, "dead");

  // A live clip of a self-collision: turn the snake into its own body.
  await liveClip(api, { snake, dir: "down", pellet: { col: 5, row: 1 }, ms: 700 });
  return check.verdict();
}
