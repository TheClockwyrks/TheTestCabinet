// Automated validation for quality.plain-combine-midwave: a plain COMBINE of only standing
// towers is allowed during a live wave, climbs their quality, and does NOT restart the wave.
//
// Two standing capacitors are built over two levels; the second keep launches Wave 2 (live).
// During that live wave the two standing towers are combined — the phase stays "wave", the
// result climbs a tier, and the partner hardens into a blocker.

import { startBuild, placeCandidate, towerAt, snap, clearWave, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("quality.plain-combine-midwave");

  await startBuild(api);
  await api.call("setIntegrity", 999);

  const a = await placeCandidate(api, "capacitor", 3, 2, 7);
  await api.call("keep", a.id); // Wave 1
  await clearWave(api, 200);

  const b = await placeCandidate(api, "capacitor", 3, 6, 7);
  await api.call("keep", b.id); // Wave 2 — now LIVE
  let s = await snap(api);
  check.expectEq("a wave is live", s.phase, "wave");

  // Combine the two STANDING towers during the live wave.
  await api.call("setCombineSet", [a.id, b.id]);
  await api.call("combine", a.id);

  s = await snap(api);
  check.expectEq("the standing combine produced a higher tier", towerAt(s, 2, 7).quality, 4);
  check.expectEq("...without restarting the wave (still live)", s.phase, "wave");
  check.expectEq("the partner hardened into a blocker", towerAt(s, 6, 7).kind, "blocker");

  await liveClip(api);
  return check.verdict();
}
