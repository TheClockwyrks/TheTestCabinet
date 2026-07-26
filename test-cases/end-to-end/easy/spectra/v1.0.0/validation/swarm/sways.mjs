// Automated validation for the Swarm sub-item `sways`.
//
// The formation drifts side to side as one rigid body: its drones share the same
// horizontal sway, swinging about ±20 px about their slots between the peak
// (waveTime 1.25) and the trough (waveTime 3.75). Several formation drones are
// posed and the real sway is advanced to each extreme; each drone's offset from its
// own slot (snapshot slotX) is read back. Reading offset-from-slot makes the check
// robust to any drone that dives out between samples — only the ones still in
// formation are read.

import {
  startStageClean,
  spawnDrone,
  SWAY_AMP,
  SWAY_PEAK_TICKS,
} from "../_helpers.mjs";

// From the +amplitude peak (waveTime 1.25) to the -amplitude trough (waveTime 3.75)
// is half a sway period: 2.5 s, or 300 ticks.
const PEAK_TO_TROUGH_TICKS = 300;

// Offsets of every formation drone from its own slot x.
function formationOffsets(snap) {
  return snap.drones
    .filter((d) => d.phase === "formation")
    .map((d) => d.x - d.slotX);
}
const spread = (xs) => Math.max(...xs) - Math.min(...xs);

export default function item() {
  // The offsets at each extreme of the swing.
  let peak;
  let trough;

  return {
    id: "swarm.sways",

    // Five drones spread across the formation's width, so "they all share one sway"
    // is a claim with enough samples to be worth making. `startStageClean` puts
    // waveTime at 0, which is what makes the peak and trough land at known instants.
    async arrange(api) {
      await startStageClean(api, 1); // waveTime starts at 0, field cleared
      for (const x of [400, 520, 640, 760, 880]) {
        await spawnDrone(api, {
          kind: "shard",
          band: "cyan",
          x,
          y: 200,
          phase: "formation",
        });
      }
    },

    // A full swing from one extreme to the other — the motion under test, and a clip
    // in which a reviewer can see the whole formation drifting as one body.
    async act(api) {
      // Peak: waveTime 1.25 -> sway = +20 (before the first auto-dive at ~2.0s).
      await api.advance(SWAY_PEAK_TICKS);
      peak = formationOffsets(await api.snapshot());

      // Trough: waveTime 3.75 -> sway = -20.
      await api.advance(PEAK_TO_TROUGH_TICKS);
      trough = formationOffsets(await api.snapshot());
    },

    async assert(api, check) {
      check.expectGt(
        "several drones are still in formation at the peak",
        peak.length,
        1,
      );
      check.expectClose(
        "the formation is at its +sway peak",
        peak[0],
        SWAY_AMP,
        0.5,
      );
      check.expectLt(
        "all peak offsets are equal (rigid body)",
        spread(peak),
        0.01,
      );

      check.expectGt(
        "several drones are still in formation at the trough",
        trough.length,
        1,
      );
      check.expectClose(
        "the formation is at its -sway trough",
        trough[0],
        -SWAY_AMP,
        0.5,
      );
      check.expectLt(
        "all trough offsets are equal (rigid body)",
        spread(trough),
        0.01,
      );
    },
  };
}
