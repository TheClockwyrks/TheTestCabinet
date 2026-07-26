// Automated validation for pathing.ordered-waypoints: a ground unit walks the ordered
// waypoint chain (Entry, WP1..WPk, Collector) in sequence and grounds out at the Collector.
//
// A unit is spawned at the Entry through the real spawner and the real pathfinder walks it;
// we read back its `waypointIndex` (the next chain node it heads to) over the walk and
// confirm it only ever rises — it never skips or reorders a waypoint — and reaches the final
// chain node, then costs Grid Integrity when it grounds out.
//
// Opening the run and releasing the Spark are control ops (the arrange). The walk is the
// behavior under test, so it is the act — and one unit now serves both purposes. The old script
// released TWO Sparks: one to film in real time and a second, walking the identical chain, to
// measure under instant stepping. The two-pass runtime makes that split unnecessary, and the
// duplicate would have put a stray second unit in the clip.

import { startBuild, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

// The old loop read the unit every 0.25 s for up to 200 reads. 0.25 s = 15 ticks exactly.
const SAMPLES = 200;
const SAMPLE_TICKS = 0.25 * SECOND;

export default function item() {
  // The chain shape and opening integrity, plus what the walk showed.
  let chainNodes;
  let integ0;
  let u;
  let monotonic = true;
  let maxWp = 0;
  let integEnd;

  return {
    id: "pathing.ordered-waypoints",

    async arrange(api) {
      const s0 = await startBuild(api);
      chainNodes = s0.waypoints.length + 1; // WPk .. Collector index in the chain [E, WP1.., C]
      integ0 = s0.integrity;

      [u] = await spawnControlled(api, "spark"); // 120 px/s — a quicker traverse to measure
    },

    async act(api) {
      let prev = 0;
      for (let i = 0; i < SAMPLES; i += 1) {
        await api.advance(SAMPLE_TICKS);
        const s = await snap(api);
        const live = unitById(s, u.id);
        if (!live) break; // it grounded out (leaked) at the Collector
        if (live.waypointIndex < prev) monotonic = false;
        prev = live.waypointIndex;
        if (prev > maxWp) maxWp = prev;
      }
      integEnd = (await snap(api)).integrity;
    },

    async assert(api, check) {
      check.expectOk("a unit was released at the Entry", !!u);
      check.expectOk("the unit visited its waypoints in non-decreasing order (never skipping or reordering)", monotonic);
      check.expectGe("the unit reached the final chain node (the Collector)", maxWp, chainNodes);
      check.expectLt("grounding out at the Collector cost Grid Integrity", integEnd, integ0);
    },
  };
}
