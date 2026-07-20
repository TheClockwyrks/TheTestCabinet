// Automated validation for the Stages sub-item `challenge-alternating`.
//
// A challenge stage's single-band groups alternate bands, cyan then magenta then
// cyan. A real challenge stage is stepped through and every drone's band and
// first-seen time are recorded; the drones cluster into groups by arrival time,
// and each cluster is confirmed single-band with consecutive clusters alternating.

import { startStageClean, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stages.challenge-alternating");

  await startStageClean(api, 3, { clear: false });

  const firstSeen = new Map(); // id -> { t, band }
  for (let i = 0; i < 80; i += 1) {
    await api.step(0.1);
    const s = await api.snapshot();
    for (const d of s.drones) {
      if (!firstSeen.has(d.id)) firstSeen.set(d.id, { t: s.simTime, band: d.band });
    }
    if (s.screen !== "inWave") break;
  }

  // Cluster drones into groups by arrival time (within-group releases are ~0.14s
  // apart; groups are ~2.2s apart, so a gap over 1s marks a new group).
  const entries = [...firstSeen.values()].sort((a, b) => a.t - b.t);
  const clusters = [];
  for (const e of entries) {
    const last = clusters[clusters.length - 1];
    if (!last || e.t - last.t > 1.0) clusters.push({ t: e.t, bands: new Set([e.band]) });
    else {
      last.bands.add(e.band);
      last.t = e.t;
    }
  }

  check.expectGe("at least three challenge groups were seen", clusters.length, 3);
  const homogeneous = clusters.every((c) => c.bands.size === 1);
  check.expectOk("each challenge group is a single band", homogeneous);
  let alternates = clusters.length >= 2;
  for (let i = 1; i < clusters.length; i += 1) {
    const a = [...clusters[i - 1].bands][0];
    const b = [...clusters[i].bands][0];
    if (a === b) alternates = false;
  }
  check.expectOk("consecutive groups alternate bands", alternates);

  await clip(api, 2000);
  return check.verdict();
}
