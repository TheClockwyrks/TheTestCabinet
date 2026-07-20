// Automated validation for the Movement sub-item `no-speedup-when-long`.
//
// A long snake advances at the same fixed rate as a short one — growth never speeds
// the tick up. A 30-cell snake is posed in a clear lane (a precondition), then one
// second is stepped under the manual clock; it must advance exactly eight cells, the
// same as a length-3 snake would.

import { makeLongSnake, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.no-speedup-when-long");

  const long = makeLongSnake();
  await beginRound(api);
  await api.call("setSnake", long.snake, long.dir);
  await api.call("setPellet", PARK_PELLET);

  const before = await api.snapshot();
  check.expectEq("the posed snake is 30 cells long", before.length, 30);
  check.expectEq("the head starts at col 8", before.snake[0].col, long.headCol);

  await api.step(1.0); // one second of game time
  const s = await api.snapshot();

  check.expectEq("one second is still exactly eight ticks", s.ticks, 8);
  check.expectEq(
    "the long snake advanced exactly eight cells (no speed-up)",
    s.snake[0].col,
    long.headCol + long.advance, // 8 + 8 = 16
  );
  check.expectEq("the snake is still 30 cells long", s.length, 30);
  check.expectEq("the round is still live", s.ended, false);

  await liveClip(api, { snake: makeLongSnake().snake, dir: "right", pellet: PARK_PELLET });
  return check.verdict();
}
