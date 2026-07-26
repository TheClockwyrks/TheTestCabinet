// Automated validation for core-run.save-blocked.
//
// The Save Pad refuses to save while the unstable Core Sample's timer is running. We try to save
// while carrying a live Sample (must be refused), then — as a control — start fresh with no Sample
// and confirm a normal save succeeds.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let blocked;
  let allowed;

  return {
    id: "core-run.save-blocked",

    // Blocked: a live Sample must prevent the save.
    async arrange(api) {
      await newRun(api); // clears any save, miner on the surface
      await api.call("spawnCoreSample");
      await api.call("save");
      blocked = (await api.snapshot()).hasSave;
    },

    async act(api) {
      // Control: with no Sample, a surface save succeeds — proving the save path itself works.
      // `startExpedition` is a control op, so it re-poses the run without the reset the runtime
      // forbids here.
      await api.call("startExpedition", "standard", "standard"); // fresh expedition, no Sample, save cleared
      await api.call("save");
      allowed = (await api.snapshot()).hasSave;

      // A beat of live play on the surface with the save banked, so the clip is not empty.
      // 30 ticks = 0.5 s, the old 500 ms clip tail.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq(
        "saving is refused while a Sample is live",
        blocked,
        false,
      );
      check.expectEq("a normal surface save succeeds", allowed, true);
    },
  };
}
