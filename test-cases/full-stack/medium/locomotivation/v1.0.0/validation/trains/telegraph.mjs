// Trains: a crossing signal reads clear with no train, warning as one approaches within the
// telegraph lead, and danger as it is upon the crossing. Level 1's signal watches the row-8
// lane; a real commuter is spawned and advanced toward the crossing.

import { startFresh, TICK } from "../_helpers.mjs";

const stateOf = (snap) =>
  (snap.signals.find((s) => s.id === "s-T0") ?? snap.signals[0]).state;

export default function item() {
  // The signal's state at each of the three stages.
  let clear;
  let warning;
  let danger;

  return {
    id: "trains.telegraph",

    // Enter level 1 with no train anywhere, and read the signal's resting state — a pure
    // snapshot read, so it costs no time.
    async arrange(api) {
      await startFresh(api, 1);
      clear = stateOf(await api.snapshot());
    },

    // Spawn the commuter and let it run at the crossing. The signal walking clear →
    // warning → danger as the train closes IS the behavior under test and IS the clip.
    async act(api) {
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "commuter",
        headPos: 0,
      });

      await api.advance(TICK);
      warning = stateOf(await api.snapshot());

      await api.advance(30); // 30 ticks = the old 0.5s — the train reaches the crossing
      danger = stateOf(await api.snapshot());

      // Keep filming as the train clears the crossing. 48 ticks = the old 800ms clip hold.
      await api.advance(48);
    },

    async assert(api, check) {
      check.expectEq("the signal is clear with no train", clear, "clear");
      check.expectEq(
        "the signal warns as the train approaches",
        warning,
        "warning",
      );
      check.expectEq(
        "the signal shows danger upon the crossing",
        danger,
        "danger",
      );
    },
  };
}
