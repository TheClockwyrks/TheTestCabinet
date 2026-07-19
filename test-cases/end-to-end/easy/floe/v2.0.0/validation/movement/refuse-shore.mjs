// Automated validation for the Movement item `refuse-shore`.
//
// Hopping up into the solid far-shore wall between the bays is refused — no move,
// no death. The critter is stood on a floe just below a solid-shore column (col 8,
// between bay 0 and bay 1) so it survives there, then a real up-hop is refused.
// See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.refuse-shore");

  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [8], speed: 0 }); // floe under col 8
  await api.call("placeCritter", 8, WATER_TOP);
  check.expectEq("standing on a floe below the solid shore", (await api.snapshot()).critter.footing, "floe");

  await api.call("press", "ArrowUp");
  await api.step(0.15);
  const s = await api.snapshot();
  check.expectEq("a hop up into the solid far-shore is refused (row unchanged)", s.critter.row, WATER_TOP);
  check.expectEq("no death", s.screen, "playing");
  check.expectNe("still crossing", s.phase, "dying");

  // Clip: the critter bumping the solid shore in real time.
  await api.call("setLane", WATER_TOP, { cols: [8], speed: 0 });
  await api.call("placeCritter", 8, WATER_TOP);
  await api.call("setAutoStep", true);
  await api.wait(250);
  await api.call("keyDown", "ArrowUp");
  await api.wait(500);
  await api.call("keyUp", "ArrowUp");
  await api.wait(200);

  return check.verdict();
}
