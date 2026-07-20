// Automated validation for the Swarm sub-item `sways`.
//
// The formation drifts side to side as one rigid body: its drones share the same
// horizontal sway, swinging about ±20 px about their slots between the peak
// (waveTime 1.25) and the trough (waveTime 3.75). Several formation drones are
// posed and the real sway is stepped to each extreme; each drone's offset from its
// own slot (snapshot slotX) is read back. Reading offset-from-slot makes the check
// robust to any drone that dives out between samples — only the ones still in
// formation are read.

import { startStageClean, spawnDrone, SWAY_AMP, clip } from "../_helpers.mjs";

// Offsets of every formation drone from its own slot x.
function formationOffsets(snap) {
  return snap.drones
    .filter((d) => d.phase === "formation")
    .map((d) => d.x - d.slotX);
}
const spread = (xs) => Math.max(...xs) - Math.min(...xs);

export default async function drive(api, ttc) {
  const check = ttc.checkOne("swarm.sways");

  await startStageClean(api, 1); // waveTime starts at 0, field cleared
  for (const x of [400, 520, 640, 760, 880]) {
    await spawnDrone(api, { kind: "shard", band: "cyan", x, y: 200, phase: "formation" });
  }

  // Peak: waveTime 1.25 -> sway = +20 (before the first auto-dive at ~2.0s).
  await api.step(1.25);
  const peak = formationOffsets(await api.snapshot());
  check.expectGt("several drones are still in formation at the peak", peak.length, 1);
  check.expectClose("the formation is at its +sway peak", peak[0], SWAY_AMP, 0.5);
  check.expectLt("all peak offsets are equal (rigid body)", spread(peak), 0.01);

  // Trough: waveTime 3.75 -> sway = -20.
  await api.step(2.5);
  const trough = formationOffsets(await api.snapshot());
  check.expectGt("several drones are still in formation at the trough", trough.length, 1);
  check.expectClose("the formation is at its -sway trough", trough[0], -SWAY_AMP, 0.5);
  check.expectLt("all trough offsets are equal (rigid body)", spread(trough), 0.01);

  await clip(api, 1400);
  return check.verdict();
}
