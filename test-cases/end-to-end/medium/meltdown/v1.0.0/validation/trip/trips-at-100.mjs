// Automated validation for the Trip sub-item `trips-at-100`.
//
// Driving an emitter's heat to 100 trips it offline (specs/heat.md). A Stutter is
// placed with a real Core target in range and posed near its redline as a
// precondition; the real firing/heat systems drive it the rest of the way to 100,
// where the real trip system takes it offline. A tripped tower stops firing, so we
// read `tripped` true and `firing` false — it deals no damage while offline.

import { newGame, combatSetup, tower, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trip.trips-at-100");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const { id } = await combatSetup(api, "stutter");
  await api.call("setHeat", id, 92); // near the redline; firing carries it to 100

  const r = await stepUntil(api, (s) => s.towers.some((t) => t.id === id && t.tripped), 6);
  // The step that crosses the redline still fired earlier in that same step, before
  // the trip took hold; advance one more step so we observe the tower while it is
  // actually offline — where it deals no damage.
  await api.step(1 / 60);
  const t = await tower(api, id);

  check.expectOk("the Stutter tripped from overheating", r.hit);
  check.expectEq("a tripped tower is offline", t.tripped, true);
  check.expectEq("a tripped tower is not firing (deals no damage)", t.firing, false);
  check.expectGt("its trip cooldown is counting", t.tripTimer, 0);

  // A clip: a fresh emitter overheating and tripping under fire.
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const c = await combatSetup(api, "stutter");
  await api.call("setHeat", c.id, 85);
  await liveClip(api, 2000);
  return check.verdict();
}
