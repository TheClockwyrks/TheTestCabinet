// Automated validation for the Stages sub-item `challenge-alternating`.
//
// A challenge stage's single-band groups alternate bands, cyan then magenta then
// cyan. A real challenge stage is stepped through and every drone's band and
// arrival time recorded; the drones cluster into groups by arrival, and each
// cluster is confirmed single-band with consecutive clusters alternating.

import { startStageClean, FIELD_H } from "../_helpers.mjs";

const SAMPLES = 140;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1 s between reads

// A drone counts as having ARRIVED once its body is inside the play field.
//
// A build may hold its whole flyover queued off-screen above the field and let it
// descend group by group, in which case every drone sits in `snapshot.drones` from
// the first tick. The old script keyed on "first seen in the snapshot" and so read
// all forty as a single group, failing a stage whose banding was in fact perfect.
// Where a drone IS, not when it was constructed, is what a player sees and what the
// groups are made of.
const FIELD_TOP = 64; // the play field's top edge (specs/playfield.md)

// A gap in arrivals this many times the typical one marks a group boundary, with a
// floor so a build that releases a whole group on one tick (median gap 0) still
// clusters. Deriving the boundary from the run rather than hardcoding a number of
// seconds keeps this working whether a build sweeps each group in over two seconds
// or releases it all at once — the spec fixes neither, only that the groups are
// separate and take turns.
const BOUNDARY_FACTOR = 3;
const BOUNDARY_FLOOR = 0.4; // seconds

/** The middle value of a non-empty list, for the boundary above. */
function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export default function item() {
  // id -> { t, band } for every drone, at the moment it arrived on the field.
  const arrivals = new Map();

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
          if (arrivals.has(d.id)) continue;
          if (d.y < FIELD_TOP || d.y > FIELD_H) continue; // not on the field yet
          // The band read is `effectiveBand`, the field the snapshot contract
          // defines as "what it currently reads and counts as" — which is what the
          // player has to match. No inversion runs during a challenge stage, so it
          // is the drone's band either way; reading it keeps this agreeing with the
          // other band checks in the case.
          arrivals.set(d.id, { t: s.simTime, band: d.effectiveBand ?? d.band });
        }
        if (s.screen !== "inWave") break;
      }
    },

    // The clustering is pure arithmetic over what `act` recorded, so it belongs here
    // rather than in the filmed phase.
    async assert(api, check) {
      const entries = [...arrivals.values()].sort((a, b) => a.t - b.t);
      check.expectGt("challenge drones fly onto the field", entries.length, 0);
      if (entries.length === 0) return;

      const gaps = entries.slice(1).map((e, i) => e.t - entries[i].t);
      const boundary = gaps.length
        ? Math.max(BOUNDARY_FLOOR, BOUNDARY_FACTOR * median(gaps))
        : BOUNDARY_FLOOR;

      const clusters = [];
      for (const e of entries) {
        const last = clusters[clusters.length - 1];
        if (!last || e.t - last.t > boundary)
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
