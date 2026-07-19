// Automated validation for the Movement item `refuse-vehicle`.
//
// Hopping into a tile a vehicle already occupies is refused like a wall — the
// critter does not move and does not die (death comes only when traffic runs into
// you). A stationary plow is parked on the tile beside the critter, then a real
// hop toward it is attempted. See validation/_helpers.mjs.

import { startCrossing, ICE_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.refuse-vehicle");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("setLane", ICE_TOP, { cols: [21], speed: 0 }); // plow parked on cols 21..23
  await api.call("placeCritter", 20, ICE_TOP);

  await api.call("press", "ArrowRight");
  await api.step(0.2);
  const s = await api.snapshot();
  check.expectEq("a hop into a vehicle-occupied tile is refused (column unchanged)", s.critter.col, 20);
  check.expectEq("no death from a refused hop into traffic", s.screen, "playing");
  check.expectNe("no crush from stepping toward parked traffic", s.phase, "dying");
  check.expectEq("lives unchanged", s.lives, 3);

  // Clip: the critter bumping the parked vehicle in real time.
  await api.call("setLane", ICE_TOP, { cols: [21], speed: 0 });
  await api.call("placeCritter", 20, ICE_TOP);
  await api.wait(250);
  await api.call("keyDown", "ArrowRight");
  await api.wait(500);
  await api.call("keyUp", "ArrowRight");
  await api.wait(200);

  return check.verdict();
}
