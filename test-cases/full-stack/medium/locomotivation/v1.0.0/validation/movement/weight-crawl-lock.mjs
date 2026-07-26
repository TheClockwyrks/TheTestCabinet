// Movement: a load over ~80% of the cap slows the worker further AND locks out sprint
// entirely. A "load" + a "parcel" (110 of 120, w ≈ 0.917) crawls, and holding Shift does
// nothing — the worker never sprints.

import {
  actHoldMeasure,
  setTile,
  startFresh,
  expectedSpeed,
  WEIGHT,
} from "../_helpers.mjs";

const CRAWL = expectedSpeed(WEIGHT.load + WEIGHT.parcel); // ~93.33 px/s, no sprint

// The measured hold, in ticks and in the seconds it represents. 30 ticks = the old 0.5s
// exactly. The seconds form is needed too: the distance assertion compares travel
// against speed x time, so it is an OPERAND (px/s x s = px), not a duration to advance.
const HOLD_TICKS = 30;
const HOLD_SECONDS = 0.5;

export default function item() {
  // The laden state posed in `arrange`, and what the measured hold produced.
  let laden;
  let r;

  return {
    id: "movement.weight-crawl-lock",

    // Load the worker past the sprint-lock threshold and read the resulting load state.
    // Giving packages and reading the snapshot are both instant.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 4, 12);
      await api.call("givePackage", {
        color: "red",
        weightClass: "load",
        archetype: "dispenser",
      });
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      laden = await api.snapshot();
    },

    // Hold Shift too — it must be ignored while locked. The snapshot is taken while the
    // keys are still held, so `sprinting` reflects what the movement code decided rather
    // than the moment after release.
    async act(api) {
      r = await actHoldMeasure(api, ["KeyD", "ShiftLeft"], HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectGt(
        "the load fraction is over the sprint-lock threshold",
        laden.worker.loadFraction,
        0.8,
      );
      check.expectEq(
        "sprint reports locked over 80% load",
        laden.worker.sprintLocked,
        true,
      );

      check.expectEq(
        "holding Shift does not sprint while locked",
        r.snap.worker.sprinting,
        false,
      );
      check.expectClose(
        "the overloaded crawl speed",
        r.snap.worker.speed,
        CRAWL,
        0.5,
      );
      check.expectClose(
        "the crawl covers only the reduced distance",
        r.dx,
        CRAWL * HOLD_SECONDS,
        0.5,
      );
    },
  };
}
