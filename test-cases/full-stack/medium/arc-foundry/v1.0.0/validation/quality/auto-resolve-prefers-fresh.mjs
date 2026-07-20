// Automated validation for quality.auto-resolve-prefers-fresh: an un-targeted combine prefers
// consuming a fresh candidate over a standing tower.
//
// Two matching standing towers are built over two levels; a matching fresh candidate is then
// placed and an un-targeted combine committed from one standing tower. It must consume the
// FRESH candidate (which hardens into a blocker) and leave the OTHER standing tower intact.

import { startBuild, placeCandidate, towerAt, snap, clearWave } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("quality.auto-resolve-prefers-fresh");

  await startBuild(api);
  await api.call("setIntegrity", 999);

  // Level 1: a standing capacitor@3 (A), near the Entry so its wave clears quickly.
  const a = await placeCandidate(api, "capacitor", 3, 2, 7);
  await api.call("keep", a.id);
  await clearWave(api, 200);

  // Level 2: a second standing capacitor@3 (B).
  const b = await placeCandidate(api, "capacitor", 3, 6, 7);
  await api.call("keep", b.id);
  await clearWave(api, 200);

  // Level 3: a fresh matching candidate (C), then an un-targeted combine from A.
  const c = await placeCandidate(api, "capacitor", 3, 10, 7);
  await api.call("setCombineSet", []); // no explicit set → auto-resolve
  await api.call("combine", a.id);

  const s = await snap(api);
  check.expectEq("the initiator climbed a tier (A -> T4)", towerAt(s, 2, 7).quality, 4);
  check.expectEq("the fresh candidate was consumed (its footprint is now a blocker)", towerAt(s, 10, 7).kind, "blocker");
  check.expectEq("the OTHER standing tower was left intact (fresh preferred over standing)", towerAt(s, 6, 7).kind, "component");
  check.expectEq("...still at its original tier", towerAt(s, 6, 7).quality, 3);

  await api.screenshot("fresh");
  return check.verdict();
}
