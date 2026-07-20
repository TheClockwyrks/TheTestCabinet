// Automated validation for the Stages sub-item `challenge-alternating`.
//
// A challenge stage's single-band groups alternate bands, cyan then magenta then
// cyan. A real challenge stage is stepped through and every drone's band and
// first-seen time are recorded; the drones cluster into groups by arrival time,
// and each cluster is confirmed single-band with consecutive clusters alternating.

import { startStageClean } from "../_helpers.mjs";

const SAMPLES = 80;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1 s between reads

export default function item() {
  // id -> { t, band } for every drone, at the moment it was first seen.
  const firstSeen = new Map();

  return {
    id: "stages.challenge-alternating",

    // A real challenge stage (every third stage) with the wave the game builds — the
    // grouping and its banding are the thing under test, so nothing is posed by hand.
    async arrange(api) {
      await startStageClean(api, 3, { clear: false });
    },

    // The flyover itself, which is both what the assertions read and exactly what a
    // reviewer needs to watch: group after group crossing in alternating bands. An
    // explicit loop rather than `until`, because the sweep records on every sample
    // and stops on the wave ending, not on a predicate about the current snapshot.
    async act(api) {
      for (let i = 0; i < SAMPLES; i += 1) {
        await api.advance(SAMPLE_TICKS);
        const s = await api.snapshot();
        for (const d of s.drones) {
          if (!firstSeen.has(d.id))
            firstSeen.set(d.id, { t: s.simTime, band: d.band });
        }
        if (s.screen !== "inWave") break;
      }
    },

    // The clustering is pure arithmetic over what `act` recorded, so it belongs here
    // rather than in the filmed phase.
    async assert(api, check) {
      // Cluster drones into groups by arrival time (within-group releases are ~0.14s
      // apart; groups are ~2.2s apart, so a gap over 1s marks a new group).
      const entries = [...firstSeen.values()].sort((a, b) => a.t - b.t);
      const clusters = [];
      for (const e of entries) {
        const last = clusters[clusters.length - 1];
        if (!last || e.t - last.t > 1.0)
          clusters.push({ t: e.t, bands: new Set([e.band]) });
        else {
          last.bands.add(e.band);
          last.t = e.t;
        }
      }

      check.expectGe(
        "at least three challenge groups were seen",
        clusters.length,
        3,
      );
      const homogeneous = clusters.every((c) => c.bands.size === 1);
      check.expectOk("each challenge group is a single band", homogeneous);
      let alternates = clusters.length >= 2;
      for (let i = 1; i < clusters.length; i += 1) {
        const a = [...clusters[i - 1].bands][0];
        const b = [...clusters[i].bands][0];
        if (a === b) alternates = false;
      }
      check.expectOk("consecutive groups alternate bands", alternates);
    },
  };
}
