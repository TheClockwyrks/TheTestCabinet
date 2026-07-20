// Automated validation for quality.combine-climbs: folding two matching pieces (same type and
// quality) produces one component a tier higher at the initiating piece's footprint, and the
// consumed partner hardens into a blocker.

import { startBuild, placeCandidate, towerAt, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("quality.combine-climbs");

  await startBuild(api);
  const a = await placeCandidate(api, "capacitor", 1, 6, 7);
  const b = await placeCandidate(api, "capacitor", 1, 10, 7);

  await api.call("setCombineSet", [a.id, b.id]);
  await api.call("combine", a.id);

  const s = await snap(api);
  const at = towerAt(s, 6, 7);
  check.expectEq("the combine produced a component one tier higher", at.quality, 2);
  check.expectEq("...at the initiating piece's footprint", at.kind, "component");
  check.expectEq("...of the same type", at.type, "capacitor");
  check.expectEq("the partner hardened into a blocker", towerAt(s, 10, 7).kind, "blocker");

  await liveClip(api);
  return check.verdict();
}
