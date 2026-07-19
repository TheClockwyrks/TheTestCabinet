// Automated validation for controls.combine-c: pressing C folds the current selection — here a
// matching quality pair — immediately.

import { startBuild, placeCandidate, towerAt, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.combine-c");

  await startBuild(api);
  const a = await placeCandidate(api, "capacitor", 1, 6, 7);
  const b = await placeCandidate(api, "capacitor", 1, 10, 7);
  await api.call("setCombineSet", [a.id, b.id]); // the pair the C key will fold
  await api.call("press", "KeyC");

  const s = await snap(api);
  check.expectEq("pressing C combined the matched pair a tier higher", towerAt(s, 6, 7).quality, 2);
  check.expectEq("...at the initiating footprint", towerAt(s, 6, 7).kind, "component");

  await liveClip(api);
  return check.verdict();
}
