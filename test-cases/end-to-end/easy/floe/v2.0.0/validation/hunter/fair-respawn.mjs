// Automated validation for the Hunter item `fair-respawn`.
//
// After a crossing ends, the bear is removed and does not re-emerge onto the
// just-respawned critter — only once the fresh critter has advanced a few tiles. A
// death is driven (drowning), the fresh crossing is confirmed bear-free, the bear
// stays away while the critter idles, and returns once it advances. See
// validation/_helpers.mjs.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.fair-respawn");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("setLane", 5, { cols: [] }); // open water -> drown to end the crossing
  await api.call("placeCritter", 20, 5);
  await stepUntil(api, (s) => s.phase === "dying", 1);
  const r = await stepUntil(api, (s) => s.phase === "crossing" && s.critter.row === 19, 2, 0.05);
  check.expectOk("a fresh crossing begins after the death", r.hit);
  check.expectEq("no bear sitting on the just-respawned critter", r.snap.bears[0].present, false);

  // With the critter idle, the bear does not re-emerge.
  const idle = await stepUntil(api, (s) => s.bears[0].present, 1.0, 0.05);
  check.expectOk("the bear waits until the critter advances", !idle.hit);

  // Once the critter advances, the bear returns.
  await api.call("setLane", 15, { cols: [] });
  await api.call("placeCritter", 20, 15);
  const back = await stepUntil(api, (s) => s.bears[0].present, 1.2, 0.05);
  check.expectOk("the bear re-emerges once the fresh critter advances", back.hit);

  // Clip: the death, the empty respawn, in real time.
  await startCrossing(api);
  await api.call("setLane", 5, { cols: [] });
  await api.call("placeCritter", 20, 5);
  await api.call("setAutoStep", true);
  await api.wait(2000);

  return check.verdict();
}
