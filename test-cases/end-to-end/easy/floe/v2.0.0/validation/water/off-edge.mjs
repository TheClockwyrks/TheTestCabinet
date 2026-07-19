// Automated validation for the Water band item `off-edge`.
//
// Being carried by a floe off the side edge of the strait is death. A floe near
// the right edge is set drifting outward with the critter aboard; the real drift
// sweeps it off the edge, and the snapshot reads the death back. See
// validation/_helpers.mjs.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("water.off-edge");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("setLane", 5, { cols: [38], speed: 6, dir: 1 }); // floe near the right edge, drifting out
  await api.call("placeCritter", 38, 5);
  check.expectEq("riding a floe at the edge", (await api.snapshot()).critter.footing, "floe");

  const r = await stepUntil(api, (s) => s.phase === "dying", 2);
  check.expectOk("riding a floe off the side edge is death", r.hit);
  check.expectEq("a life is lost going off the edge", r.snap.lives, 2);

  // Clip: the floe carrying the critter off the edge in real time.
  await startCrossing(api);
  await api.call("setLane", 5, { cols: [38], speed: 6, dir: 1 });
  await api.call("placeCritter", 38, 5);
  await api.wait(1000);

  return check.verdict();
}
