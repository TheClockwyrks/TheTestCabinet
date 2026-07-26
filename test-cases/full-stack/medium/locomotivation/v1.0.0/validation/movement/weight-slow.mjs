// Movement: a load in the mid band (~50%–80%) slows the worker on a smooth ramp, with
// sprint still available. One "load" package (80 of 120, w ≈ 0.667) puts the worker in
// the band; the real speed model yields ~0.833x the base speed.

import {
  actHoldMeasure,
  setTile,
  startFresh,
  expectedSpeed,
  WEIGHT,
} from "../_helpers.mjs";

const EXPECTED = expectedSpeed(WEIGHT.load); // ~133.33 px/s

// The measured hold, in ticks and in the seconds it represents. 30 ticks = the old 0.5s
// exactly. The seconds form is an OPERAND of the distance assertion (px/s x s = px), not
// a duration to advance, so it must stay in seconds.
const HOLD_TICKS = 30;
const HOLD_SECONDS = 0.5;

export default function item() {
  // The laden state posed in `arrange`, and what the measured hold produced.
  let laden;
  let r;

  return {
    id: "movement.weight-slow",

    // Load the worker into the mid band and read the resulting load state back.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 4, 12);
      await api.call("givePackage", {
        color: "red",
        weightClass: "load",
        archetype: "dispenser",
      });
      laden = await api.snapshot();
    },

    // Half a second of laden travel, measured while the key is still held.
    async act(api) {
      r = await actHoldMeasure(api, ["KeyD"], HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectGt(
        "mid-band load fraction is over half",
        laden.worker.loadFraction,
        0.5,
      );
      check.expectLt(
        "mid-band load fraction is under the sprint-lock threshold",
        laden.worker.loadFraction,
        0.8,
      );

      check.expectClose(
        "mid-band speed is the ramped value",
        r.snap.worker.speed,
        EXPECTED,
        0.5,
      );
      check.expectClose(
        "half a second covers the ramped distance",
        r.dx,
        EXPECTED * HOLD_SECONDS,
        0.5,
      );
      check.expectEq(
        "sprint is still available in the mid band",
        r.snap.worker.sprintLocked,
        false,
      );
    },
  };
}
