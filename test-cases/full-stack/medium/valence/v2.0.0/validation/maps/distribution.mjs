// Automated validation for the Maps sub-item `distribution`.
//
// A round's matter is distributed across the map's paths so every path carries traffic.
// The check starts a real round on the branching map and steps through its spawns,
// gathering which lanes the real wave system releases matter onto — both lanes must
// receive units, so the wave is never funnelled onto one.

import { startRun, stepUntil, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maps.distribution");

  await startRun(api, MAP.branching, { round: 1, integrity: 100000 });
  await api.call("startRound");

  const seen = new Set();
  const r = await stepUntil(api, (s) => {
    for (const u of s.matter) seen.add(u.pathId);
    return seen.has(0) && seen.has(1) && s.matter.length >= 3;
  }, 20, 0.25);
  check.expectOk("lane 0 receives matter during the round", seen.has(0));
  check.expectOk("lane 1 receives matter during the round", seen.has(1));
  check.expectOk("both lanes carry traffic (not funnelled onto one)", r.hit);

  await liveClip(api, 1500);
  return check.verdict();
}
