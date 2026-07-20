// Presentation: the worker's facing follows the pressed direction — a real down/up/left/
// right character. Each direction is held briefly and the snapshot's facing read back.

import { actHoldMeasure, setTile, startFresh } from "../_helpers.mjs";

const FACINGS = [
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
];

// The old hold was 0.12s, which is 7.2 ticks at 60 Hz — NOT a whole number, so the tick
// contract refuses it rather than rounding (`ticksFor(0.12)` throws by design). Round
// DOWN to 7: this item asserts only `facing`, which the movement code sets on the very
// first step of a held key, so any hold of one tick or more probes the same thing and
// the shorter of the two candidates cannot overshoot into a neighbouring tile.
const HOLD_TICKS = 7;

export default function item() {
  // One `{ code, facing, r }` per direction, read back by `assert`.
  const results = [];

  return {
    id: "presentation.worker-facings",

    // Enter level 1. The worker is posed inside `act`, once per direction, so each
    // measurement starts from the same tile.
    async arrange(api) {
      await startFresh(api, 1);
    },

    // Turn through all four facings. This IS the clip — the old separate live tail that
    // re-held each arrow purely for the camera is gone, because the measured turns are
    // now what gets filmed. `setTile` is a control op, so re-posing between directions
    // is legal mid-act and does not touch the clock.
    async act(api) {
      for (const [code, facing] of FACINGS) {
        await setTile(api, 8, 10);
        results.push({
          code,
          facing,
          r: await actHoldMeasure(api, [code], HOLD_TICKS),
        });
      }
    },

    async assert(api, check) {
      for (const { code, facing, r } of results) {
        check.expectEq(
          `holding ${code} faces the worker ${facing}`,
          r.snap.worker.facing,
          facing,
        );
      }
    },
  };
}
