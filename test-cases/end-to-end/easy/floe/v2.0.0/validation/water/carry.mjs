// Automated validation for the Water band item `carry`.
//
// A floe carries the critter sideways at the lane velocity while it stands on it,
// and it survives there. A stationary-kind floe is set drifting under the critter's
// tile, and the real drift moves the critter with it, which the snapshot reads
// back. See validation/_helpers.mjs.

import { startCrossing, TILE } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("water.carry");

  await startCrossing(api);
  await api.call("setLane", 5, { cols: [20], speed: 3, dir: 1 }); // floe under col 20 drifting right
  await api.call("placeCritter", 20, 5);
  check.expectEq("footing on a floe reads 'floe'", (await api.snapshot()).critter.footing, "floe");

  const bx = (await api.snapshot()).critter.x;
  // A half-second step so the intended carry (tens of px) dominates any stray
  // sub-tile advance the on-screen loop may add between reads.
  const dt = 0.5;
  await api.step(dt);
  const s = await api.snapshot();
  check.expectClose("the floe carries the critter by the lane velocity", s.critter.x - bx, 3 * TILE * dt, 6);
  check.expectNe("the critter survives on the floe", s.phase, "dying");
  check.expectEq("still crossing", s.screen, "playing");

  // Clip: the critter riding the drifting floe in real time.
  await startCrossing(api);
  await api.call("setLane", 5, { cols: [20], speed: 3, dir: 1 });
  await api.call("placeCritter", 20, 5);
  await api.wait(800);

  return check.verdict();
}
