// Automated validation for pathing.ordered-waypoints: a ground unit walks the ordered
// waypoint chain (Entry, WP1..WPk, Collector) in sequence and grounds out at the Collector.
//
// A unit is spawned at the Entry through the real spawner and the real pathfinder walks it; we
// read back its `waypointIndex` (the next chain node it heads to) over the walk and confirm it
// only ever rises — it never skips or reorders a waypoint — reaches the final chain node, and
// costs Grid Integrity when it grounds out.
//
// WHAT IS FILMED. The whole walk is the measurement, but it is not the clip: a Spark crosses
// six waypoints over about a minute, which is several times the recording budget, so the old
// script's real-time sampling loop simply ran out partway across the yard and the clip was a
// minute of walking that ended nowhere near the Collector. The sampling now runs on `skip` —
// the same simulation, the same readings, instant in both passes — and the clip is the last
// stretch: the unit coming down on the Collector, grounding out, and the Grid Integrity it
// costs. That is the end of the sentence the item is describing, and the only part of it a
// reviewer cannot infer from the rest.

import {
  startBuild,
  spawnControlled,
  unitById,
  snap,
  SECOND,
} from "../_helpers.mjs";

// The sampling sweep: how often the walk is read, and how long it may take.
const SAMPLE_TICKS = 0.25 * SECOND;
const WALK_TICKS = 200 * SECOND;
// Where the filming starts: once the unit is heading for the final chain node.
const APPROACH_TICKS = 60 * SECOND;

export default function item() {
  // The chain shape and opening integrity, plus what the walk showed.
  let chainNodes;
  let integ0;
  let u;
  let monotonic = true;
  let maxWp = 0;
  let prev = 0;
  let integEnd;
  let grounded;

  // Read one sample of the walk. Used as a `skipUntil` predicate, which evaluates exactly once
  // per sample — so each reading is taken exactly once, as the running state below needs.
  const sample = (s) => {
    const live = unitById(s, u.id);
    if (!live) return true; // it grounded out (leaked) at the Collector
    if (live.waypointIndex < prev) monotonic = false;
    prev = live.waypointIndex;
    if (prev > maxWp) maxWp = prev;
    return false;
  };

  return {
    id: "pathing.ordered-waypoints",

    async arrange(api) {
      const s0 = await startBuild(api);
      // The chain is numbered from 1: the map's k waypoints are 1..k and the Collector, the node
      // a unit heads for once the last waypoint is behind it, is k + 1
      // (`specs/instrumentation.md`). So reaching k + 1 is what "it got to the Collector" means.
      chainNodes = s0.waypoints.length + 1;
      integ0 = s0.integrity;

      [u] = await spawnControlled(api, "spark"); // 120 px/s — a quicker traverse to measure

      // Sample the walk up to the point where the unit is heading for the LAST chain node, and
      // spend that walk instantly: it is the journey to the evidence, not the evidence.
      await api.skipUntil((s) => sample(s) || (unitById(s, u.id)?.waypointIndex ?? 0) >= chainNodes, {
        max: APPROACH_TICKS,
        poll: SAMPLE_TICKS,
      });
    },

    async act(api) {
      // The filmed stretch: the last leg, the ground-out at the Collector, and the integrity it
      // costs. Sampling carries on across it, so the ordering check covers the whole walk.
      await api.until(sample, { max: WALK_TICKS, poll: SAMPLE_TICKS });
      grounded = !unitById(await snap(api), u.id);
      integEnd = (await snap(api)).integrity;
    },

    async assert(api, check) {
      check.expectOk("a unit was released at the Entry", !!u);
      check.expectOk("the unit visited its waypoints in non-decreasing order (never skipping or reordering)", monotonic);
      check.expectGe(
        `the unit headed for every node of the chain, ending on the Collector (node ${chainNodes})`,
        maxWp,
        chainNodes,
      );
      check.expectOk("the unit grounded out at the Collector", grounded);
      check.expectLt("grounding out at the Collector cost Grid Integrity", integEnd, integ0);
    },
  };
}
