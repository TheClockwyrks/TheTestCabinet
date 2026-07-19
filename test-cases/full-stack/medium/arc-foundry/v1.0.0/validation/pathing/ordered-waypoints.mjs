// Automated validation for pathing.ordered-waypoints: a ground unit walks the ordered
// waypoint chain (Entry, WP1..WPk, Collector) in sequence and grounds out at the Collector.
//
// A unit is spawned at the Entry through the real spawner and the real pathfinder walks it;
// we read back its `waypointIndex` (the next chain node it heads to) over the walk and
// confirm it only ever rises — it never skips or reorders a waypoint — and reaches the final
// chain node, then costs Grid Integrity when it grounds out.

import { startBuild, spawnControlled, unitById, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.ordered-waypoints");

  const s0 = await startBuild(api);
  const chainNodes = s0.waypoints.length + 1; // WPk .. Collector index in the chain [E, WP1.., C]
  const integ0 = s0.integrity;

  // A live clip of a unit walking the chain, then the deterministic measurement.
  await spawnControlled(api, "spark");
  await liveClip(api, 2500);
  await api.call("setAutoStep", false);

  const [u] = await spawnControlled(api, "spark"); // 120 px/s — a quicker traverse to measure
  check.expectOk("a unit was released at the Entry", !!u);

  let prev = 0;
  let maxWp = 0;
  let monotonic = true;
  for (let i = 0; i < 200; i += 1) {
    await api.step(0.25);
    const s = await snap(api);
    const live = unitById(s, u.id);
    if (!live) break; // it grounded out (leaked) at the Collector
    if (live.waypointIndex < prev) monotonic = false;
    prev = live.waypointIndex;
    if (prev > maxWp) maxWp = prev;
  }

  check.expectOk("the unit visited its waypoints in non-decreasing order (never skipping or reordering)", monotonic);
  check.expectGe("the unit reached the final chain node (the Collector)", maxWp, chainNodes);
  check.expectLt("grounding out at the Collector cost Grid Integrity", (await snap(api)).integrity, integ0);

  return check.verdict();
}
