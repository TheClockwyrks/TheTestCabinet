// Automated validation for build.merge-into-standing: merging a fresh candidate into a
// matching standing base tower lands the higher-tier result at the standing tower's
// footprint, hardens the candidate's footprint into a blocker, and launches the wave.
//
// A standing capacitor is created (kept in an earlier level, its wave cleared), then a fresh
// matching capacitor candidate is placed and merged into it.

import { startBuild, placeCandidate, towerAt, snap, clearWave, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.merge-into-standing");

  await startBuild(api);
  await api.call("setIntegrity", 999);
  const standing = await placeCandidate(api, "capacitor", 3, 2, 7); // near entry: quick wave clear
  await api.call("keep", standing.id); // Wave 1
  await clearWave(api, 200); // reopen build

  const fresh = await placeCandidate(api, "capacitor", 3, 10, 7); // a matching fresh roll
  check.expectOk("a matching fresh candidate is placed", !!fresh);

  await api.call("merge", fresh.id, standing.id);
  const s = await snap(api);
  const at = towerAt(s, 2, 7);
  check.expectEq("the merge landed the higher tier at the standing tower's footprint", at.quality, 4);
  check.expectEq("...as a firing component", at.kind, "component");
  check.expectEq("the fresh candidate's footprint hardened into a blocker", towerAt(s, 10, 7).kind, "blocker");
  check.expectEq("the merge launched the wave", s.phase, "wave");

  await liveClip(api);
  return check.verdict();
}
