// Automated validation for fuel.thrust-rate-scales.
//
// The thrust burn is speed-scaled: full rate while lifting off from a stop, easing toward a
// cheaper cruise rate once climbing fast. In a tall open shaft we measure the burn per second at
// lift-off (low upward speed) and again after the empty miner has reached cruise speed.

import { K, newRun, openColumn, solid, DEEPSTONE_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fuel.thrust-rate-scales");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await openColumn(api, col, row - 45, row - 1); // a tall shaft to reach cruise speed
  await solid(api, col, row + 1);
  await api.call("teleport", col, row);
  await api.call("setFuel", 999);

  await api.call("keyDown", K.thrust);
  // Lift-off window: upward speed low → full burn rate.
  const a0 = (await api.snapshot()).miner.fuel;
  await api.step(0.1);
  const a1 = await api.snapshot();
  const rateLiftoff = (a0 - a1.miner.fuel) / 0.1;

  // Climb to cruise speed, then measure again.
  await api.step(1.6);
  const b0 = (await api.snapshot()).miner.fuel;
  await api.step(0.1);
  const b1 = await api.snapshot();
  const rateCruise = (b0 - b1.miner.fuel) / 0.1;
  await api.call("keyUp", K.thrust);

  check.expectGt("the miner reached cruise climb speed", Math.abs(b1.miner.vy), 800);
  check.expectGt("lift-off burns at the full rate", rateLiftoff, 4);
  check.expectLt("cruise burns at the eased rate", rateCruise, 3);
  check.expectGt("the burn eases as climb speed rises", rateLiftoff - rateCruise, 1.5);

  await liveClip(api, 700);
  return check.verdict();
}
