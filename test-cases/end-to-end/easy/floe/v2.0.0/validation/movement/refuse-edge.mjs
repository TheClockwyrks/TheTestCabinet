// Automated validation for the Movement item `refuse-edge`.
//
// A hop that would leave the strait is refused — the critter does not move and
// does not die. Two edges are checked through the real play code: a leftward hop
// from the leftmost column, and a downward hop from the near shore. See
// validation/_helpers.mjs.

import { startCrossing, ICE_TOP, ROW_NEAR } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.refuse-edge");

  await startCrossing(api);
  await api.call("setLane", ICE_TOP, { cols: [] });
  await api.call("placeCritter", 0, ICE_TOP); // leftmost ice tile

  await api.call("press", "ArrowLeft");
  await api.step(0.15);
  let s = await api.snapshot();
  check.expectEq("a hop off the left edge is refused (column unchanged)", s.critter.col, 0);
  check.expectEq("no death from a refused edge hop", s.screen, "playing");
  check.expectNe("still crossing", s.phase, "dying");

  // Below the near shore.
  await api.call("placeCritter", 20, ROW_NEAR);
  await api.call("press", "ArrowDown");
  await api.step(0.15);
  s = await api.snapshot();
  check.expectEq("a hop below the near shore is refused (row unchanged)", s.critter.row, ROW_NEAR);
  check.expectEq("no death", s.screen, "playing");

  // Clip: the critter pinned at the left edge, key held into it, in real time.
  await api.call("placeCritter", 0, ICE_TOP);
  await api.wait(250);
  await api.call("keyDown", "ArrowLeft");
  await api.wait(500);
  await api.call("keyUp", "ArrowLeft");
  await api.wait(200);

  return check.verdict();
}
