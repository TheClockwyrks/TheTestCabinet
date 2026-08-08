// Automated validation for the Stages sub-item `challenge-alternating`.
//
// A challenge stage's single-band groups alternate bands, cyan then magenta then
// cyan. A real challenge stage is stepped through and every drone's band and
// arrival time recorded; the groups are then read off the arrival ORDER as maximal
// same-band runs, and the bands must take turns across several substantial blocks.
// Nothing here reads a build's PACING: how long it leaves between groups is its
// own business, and only the order the player must answer is scored.

import { startStageClean } from "../_helpers.mjs";

const SAMPLES = 140;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1 s between reads

// A drone counts as having ARRIVED the first time it MOVES — the moment its group
// is released and it starts flying its path.
//
// Neither of the two obvious definitions works across builds. "First seen in the
// snapshot" is wrong for a build that constructs its whole flyover up front and
// holds it: all forty are in `snapshot.drones` from the first tick, so they read as
// one group and a perfectly banded stage fails. "Inside the play field" is wrong
// too, and in the opposite direction: a challenge flyover sweeps ACROSS the field
// (`specs/gameplay.md`: "each group sweeps across the field along set paths and
// exits"), so a group enters from off the left or right edge strung out over
// several hundred px — its members cross onto the screen over a second or more,
// which interleaves with the next group's release and makes the arrivals look
// band-mixed when the release order is immaculate.
//
// Movement is the signal both shapes agree on. A queued drone sits still whether it
// is off-screen or parked at its slot; a released one starts moving at once. So
// this reads the release order — which is exactly what "groups" means here — on a
// build that holds its flyover and on one that streams it, without assuming either.
// Measured against the reference, it recovers the five groups of eight cleanly,
// 1.2 s apart, alternating; the field-bounds test on the same build produced
// interleaved arrivals like `m c m` inside one group.
//
// A drone counts as moving if it shifted at all since the previous sample; a
// released drone crosses many px per sample at any plausible flyover speed.
const MOVED_EPSILON = 0.5;

// The smallest a single-band group may be and still read as a group to pre-flip
// for. `specs/gameplay.md` asks for groups of 8; this is half of that, so a build
// is free to size its groups differently while a per-drone band shuffle still
// fails.
const MIN_GROUP_SIZE = 4;

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
      let previous = new Map();
      for (let i = 0; i < SAMPLES; i += 1) {
        await api.advance(SAMPLE_TICKS);
        const s = await api.snapshot();
        for (const d of s.drones) {
          if (arrivals.has(d.id)) continue;
          const was = previous.get(d.id);
          // First sighting: no previous position to measure a release against, so
          // wait for the next sample rather than guessing.
          if (!was) continue;
          if (Math.hypot(d.x - was.x, d.y - was.y) <= MOVED_EPSILON) continue;
          // The band read is `effectiveBand`, the field the snapshot contract
          // defines as "what it currently reads and counts as" — which is what the
          // player has to match. No inversion runs during a challenge stage, so it
          // is the drone's band either way; reading it keeps this agreeing with the
          // other band checks in the case.
          arrivals.set(d.id, { t: s.simTime, band: d.effectiveBand ?? d.band });
        }
        previous = new Map(s.drones.map((d) => [d.id, { x: d.x, y: d.y }]));
        if (s.screen !== "inWave") break;
      }
    },

    // The clustering is pure arithmetic over what `act` recorded, so it belongs here
    // rather than in the filmed phase.
    async assert(api, check) {
      const entries = [...arrivals.values()].sort((a, b) => a.t - b.t);
      check.expectGt("challenge drones fly onto the field", entries.length, 0);
      if (entries.length === 0) return;

      // Drones released on the SAME instant must share a band.
      //
      // This is the tight half of "each group is entirely one band", and it is keyed
      // on simultaneity rather than on a gap derived from the run. An earlier version
      // clustered arrivals by a boundary of three times the median gap and required
      // each cluster to be single-band — which quietly assumed a build PAUSES between
      // groups. One does not: it streams all forty in at a uniform 0.2 s spacing,
      // band-ordered in blocks of eight, so the gap at a group boundary is exactly
      // the gap inside a group, every arrival fell into one cluster, and a flyover
      // that presents the player with eight cyan, then eight magenta, then eight
      // cyan was reported as mixing its bands. Nothing in `specs/gameplay.md`
      // requires a pause; it requires the groups to be single-band and to alternate,
      // which that build does.
      //
      // Simultaneous arrivals cannot be confounded that way: if two drones enter on
      // the same tick, the player really is being shown both bands at once.
      const waves = new Map();
      for (const e of entries) {
        const at = waves.get(e.t) ?? new Set();
        at.add(e.band);
        waves.set(e.t, at);
      }
      check.expectOk(
        "no two drones arriving at the same instant carry different bands",
        [...waves.values()].every((bands) => bands.size === 1),
      );

      // The GROUPS the spec counts, read off the ARRIVAL ORDER rather than off any
      // notion of pacing.
      //
      // `specs/gameplay.md` asks for "about 5 groups of 8 drones", each one band, the
      // groups alternating, "so you pre-flip to a group's band and rake it before the
      // next arrives". What a player experiences of that is the ORDER: a run of one
      // band, then a run of the other. How briskly a build feeds them — all at once,
      // in two half-waves, or in an unbroken stream — is its own business and changes
      // nothing about what the player has to do.
      //
      // So a CHANGE OF BAND is the group boundary, and the groups are the maximal
      // same-band runs. That makes "each group is one band" and "the groups
      // alternate" true by construction, so what is actually asserted below is the
      // content those carried: the bands take turns, several times over, in
      // substantial blocks rather than a drone-by-drone shuffle.
      const groups = [];
      for (const e of entries) {
        const last = groups[groups.length - 1];
        if (last && last.band === e.band) last.n += 1;
        else groups.push({ band: e.band, n: 1 });
      }

      check.expectGe(
        "the bands take turns across at least three groups",
        groups.length,
        3,
      );
      // A build that alternated band per drone would produce forty groups of one,
      // satisfying "the bands take turns" while showing the player nothing to
      // pre-flip for. The spec's groups are 8 strong; half of that is the floor.
      check.expectGe(
        "each group is a block of drones, not a drone-by-drone shuffle",
        Math.min(...groups.map((g) => g.n)),
        MIN_GROUP_SIZE,
      );
    },
  };
}
