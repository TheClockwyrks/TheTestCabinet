// Movement: a load up to ~50% of the cap imposes no penalty. Two parcels (60 of 120,
// w = 0.5) leave the worker at the full base speed. The load is a precondition; the
// real speed model then runs forward.

import { actHoldMeasure, setTile, startFresh, V0 } from "../_helpers.mjs";

// The measured hold, in ticks and in the seconds it represents. 30 ticks = the old 0.5s
// exactly. The seconds form is an OPERAND of the distance assertion (px/s x s = px), not
// a duration to advance, so it must stay in seconds.
const HOLD_TICKS = 30;
const HOLD_SECONDS = 0.5;

export default function item() {
  // The load fraction posed in `arrange`, and what the measured hold produced.
  let loadFraction;
  let r;

  return {
    id: "movement.weight-full",

    // Load the worker to exactly half the cap and read the resulting fraction back.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 4, 12);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      loadFraction = (await api.snapshot()).worker.loadFraction;
    },

    // Half a second of laden travel, measured while the key is still held.
    async act(api) {
      r = await actHoldMeasure(api, ["KeyD"], HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectClose("half-cap load fraction", loadFraction, 0.5, 1e-6);
      check.expectClose(
        "half-laden speed is still the full base speed",
        r.snap.worker.speed,
        V0,
        0.5,
      );
      check.expectClose(
        "half a second covers 80 px unpenalized",
        r.dx,
        V0 * HOLD_SECONDS,
        0.5,
      );
      check.expectEq(
        "sprint is not locked at half load",
        r.snap.worker.sprintLocked,
        false,
      );
    },
  };
}
