// Automated validation for core-run.jettison-survive.
//
// Jettisoning the Sample and fleeing beyond the blast radius survives its ground detonation; the
// Sample is destroyed but the miner lives. We extract, jettison, flee far, run past the timer, and
// confirm the miner is still alive with the Sample gone.

import { newRun, solid, SPAWN_COL, DEEPSTONE_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let dropped;
  let snap;

  return {
    id: "core-run.jettison-survive",

    // Extract the Sample and drop it on this tile; its timer keeps running on the ground.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await solid(api, col, row + 1);
      await api.call("teleport", col, row);
      await api.call("spawnCoreSample");
      await api.call("jettison"); // drop it on this tile; timer keeps running
      dropped = await api.snapshot();
    },

    async act(api) {
      // Flee well beyond the blast radius (~3 tiles). Control ops only — a reset here would take
      // the clock back and freeze the recording.
      await api.call("teleport", col + 10, row);
      await solid(api, col + 10, row + 1);
      await api.call("teleport", col + 10, row);

      // 5520 ticks = 92 s: past the timer, so the ground detonation fires far away. The record pass
      // stops at its clip budget partway through, which is the correct outcome for a 92-second wait.
      await api.advance(5520);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk(
        "the Sample is a ground item after jettison",
        !!dropped.coreGround,
      );
      check.expectEq(
        "it is no longer carried",
        dropped.satchel.coreSample,
        false,
      );
      check.expectEq(
        "the miner survives the distant detonation",
        snap.screen,
        "in-mine",
      );
      check.expectEq("the Sample is destroyed", snap.coreGround, null);
      check.expectEq("the timer has ended", snap.coreTimer, null);
    },
  };
}
