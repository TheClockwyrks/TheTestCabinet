// Automated validation for the Ice band item `crush`.
//
// A vehicle that slides INTO the critter's own tile crushes it — a life is lost.
// The critter is stood on an ice tile and a plow is set sliding into it from the
// next tile; the real motion and collision decide the crush, which the snapshot
// reads back. See validation/_helpers.mjs.

import { startCrossing, stepUntil, ICE_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ice.crush");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("setLane", ICE_TOP, { cols: [21], speed: 8, dir: -1 }); // plow sweeping left into the critter
  await api.call("placeCritter", 20, ICE_TOP);

  const r = await stepUntil(api, (s) => s.phase === "dying", 1.5);
  check.expectOk("a vehicle sliding into the critter's tile crushes it", r.hit);
  check.expectEq("the phase is dying after the crush", r.snap.phase, "dying");
  check.expectEq("a life is lost to the crush", r.snap.lives, 2);

  // Clip: the plow sliding into the critter in real time.
  await startCrossing(api);
  await api.call("setLane", ICE_TOP, { cols: [21], speed: 6, dir: -1 });
  await api.call("placeCritter", 20, ICE_TOP);
  await api.call("setAutoStep", true);
  await api.wait(800);

  return check.verdict();
}
