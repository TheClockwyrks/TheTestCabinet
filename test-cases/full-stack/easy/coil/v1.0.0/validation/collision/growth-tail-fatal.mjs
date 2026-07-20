// Automated validation for the Collision sub-item `growth-tail-fatal`.
//
// On a growth tick the tail does not retract, so the whole body — including the
// current tail cell — is solid: moving the head into the tail cell while eating there
// is fatal. The same loop the tail-follow check uses is posed, but with the pellet ON
// the tail cell so the tick is a GROWTH tick (a precondition); one real tick resolves
// it and the outcome is read back — this time the round must end as a death.

import { TICK_DT, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("collision.growth-tail-fatal");

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

  await api.step(TICK_DT);
  const s = await api.snapshot();

  check.expectEq("the round ended", s.ended, true);
  check.expectEq("the screen is game-over", s.screen, "gameover");
  check.expectEq("the end reason is death", s.endReason, "dead");

  await liveClip(api, {
    snake,
    dir: "right",
    pellet: { col: 11, row: 8 },
    ms: 700,
  });
  return check.verdict();
}
