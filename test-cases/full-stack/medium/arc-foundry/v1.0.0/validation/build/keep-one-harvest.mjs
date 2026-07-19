// Automated validation for build.keep-one-harvest: KEEPing a candidate takes exactly one
// firing component off the level, hardens every other candidate into a blocker, and launches
// the wave (there is no SEND).

import { startBuild, placeCandidate, towerAt, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.keep-one-harvest");

  await startBuild(api);
  const a = await placeCandidate(api, "capacitor", 1, 6, 7);
  await placeCandidate(api, "coil", 1, 10, 7);
  await placeCandidate(api, "emitter", 1, 14, 7);
  check.expectEq("three candidates are placed", (await snap(api)).towers.filter((t) => t.kind === "candidate").length, 3);

  await api.call("keep", a.id);
  const s = await snap(api);
  check.expectEq("the kept candidate became a firing component", towerAt(s, 6, 7).kind, "component");
  check.expectEq("an un-kept candidate hardened into a blocker", towerAt(s, 10, 7).kind, "blocker");
  check.expectEq("the other un-kept candidate hardened into a blocker", towerAt(s, 14, 7).kind, "blocker");
  check.expectEq("no candidates remain (exactly one was harvested)", s.towers.filter((t) => t.kind === "candidate").length, 0);
  check.expectEq("the harvest launched the wave (there is no SEND)", s.phase, "wave");

  await liveClip(api);
  return check.verdict();
}
