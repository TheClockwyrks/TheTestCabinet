// Automated validation for the Progression item `levels`.
//
// Clearing a level advances to the next, which runs faster than the last. Four bays
// are pre-filled and the fifth cleared by a real hop; the real level logic advances
// the level and rebuilds it faster, which the snapshots read back. See
// validation/_helpers.mjs.

import { startCrossing, stepUntil, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.levels");

  await startCrossing(api);
  const l1speed = (await api.snapshot()).lanes.ice[0].speed;
  await api.call("setBays", [true, true, true, true, false]);
  await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
  await api.call("placeCritter", 35, WATER_TOP);

  await api.call("press", "ArrowUp"); // fill the fifth bay -> clear the level
  await api.step(0.15);
  const r = await stepUntil(api, (s) => s.level === 2, 2.5, 0.1);
  check.expectOk("clearing a level advances to the next", r.hit);
  check.expectEq("the level is now 2", r.snap.level, 2);
  check.expectGt("the next level runs faster", r.snap.lanes.ice[0].speed, l1speed);

  // Clip: the clear and the faster next level in real time.
  await startCrossing(api);
  await api.call("setBays", [true, true, true, true, false]);
  await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
  await api.call("placeCritter", 35, WATER_TOP);
  await api.call("setAutoStep", true);
  await api.wait(250);
  await api.call("press", "ArrowUp");
  await api.wait(2000);

  return check.verdict();
}
