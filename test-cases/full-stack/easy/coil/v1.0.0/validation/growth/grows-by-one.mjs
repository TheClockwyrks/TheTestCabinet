// Automated validation for the Growth & Pellets sub-item `grows-by-one`.
//
// Eating a pellet grows the snake by exactly one cell (the tail does not retract that
// tick); a following normal tick keeps the length constant. The snake is posed with a
// pellet one cell ahead (a precondition), one real tick runs the head into it, and the
// length is read back — then the pellet is parked away and a normal tick confirms the
// length holds.

import { TICK_DT, hLane, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("growth.grows-by-one");

  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 3), "right"); // length 3
  await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead

  check.expectEq("the snake starts at length 3", (await api.snapshot()).length, 3);

  await api.step(TICK_DT); // eat
  const eaten = await api.snapshot();
  check.expectEq("eating grew the snake by exactly one", eaten.length, 4);
  check.expectEq("the head advanced into the pellet cell", eaten.snake[0].col, 11);

  await api.call("setPellet", PARK_PELLET); // no eat on the next tick
  await api.step(TICK_DT); // a normal tick
  const after = await api.snapshot();
  check.expectEq("a following normal tick keeps the length constant", after.length, 4);

  await liveClip(api, { snake: hLane(6, 8, 4), pellet: { col: 8, row: 8 } });
  return check.verdict();
}
