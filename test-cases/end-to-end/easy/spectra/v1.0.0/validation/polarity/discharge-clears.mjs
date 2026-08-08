// Automated validation for the Polarity sub-item `discharge-clears`.
//
// At full resonance a discharge wipes every entering and diving drone and clears
// all enemy bullets (band-blind), but spares the formation. Divers, a formation
// drone, and enemy bullets are posed, the meter filled, and a REAL discharge fired;
// the expanding wave, stepped forward, resolves what it clears and what it spares.

import {
  startClean,
  holdDrones,
  spawnDrone,
  findDrone,
  enemyBullets,
} from "../_helpers.mjs";

// A full second on the posed field before the discharge is fired.
//
// This item's whole claim is a DISTINCTION — the divers and the bullets go, the
// formation drone stays — and the old clip opened on the discharge already
// expanding, so a reviewer never saw which drone was which before they started
// disappearing. A second of the arranged field first makes the three roles legible
// (one drone holding its slot up top, two divers out in the field, bullets of both
// bands in flight), so the aftermath means something.
//
// The swarm is held through it, so the posed divers are still where they were put
// when the wave reaches them, rather than a second further down their paths — and
// so the formation drone that must survive has not been peeled into a dive by the
// assault, which would make it a legitimate target and fail a correct build.
const LEAD_IN_TICKS = 120; // 1 s

// The posed enemy bullets hang still for the same reason: at 320 px/s they would
// otherwise leave the field during the lead-in, and "all enemy bullets are cleared"
// would be true because they had flown away rather than because the wave took them.
const STILL = { vx: 0, vy: 0 };

export default function item() {
  // The formation drone that must survive, and the field once the wave has passed.
  let formId;
  let snap;

  return {
    id: "polarity.discharge-clears",

    // One of each thing the discharge treats differently: a formation drone that
    // must SURVIVE, two divers that must be WIPED, and enemy bullets of both bands
    // that must be CLEARED (the wave is band-blind, so both bands are posed).
    async arrange(api) {
      await startClean(api);
      await holdDrones(api);
      formId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
      });
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 300,
        y: 300,
        phase: "diving",
      });
      await spawnDrone(api, {
        kind: "shard",
        band: "magenta",
        x: 980,
        y: 300,
        phase: "diving",
      });
      await api.call("spawnEnemyBullet", {
        x: 640,
        y: 400,
        band: "cyan",
        ...STILL,
      });
      await api.call("spawnEnemyBullet", {
        x: 520,
        y: 320,
        band: "magenta",
        ...STILL,
      });
      await api.call("setResonance", 100);
    },

    // The discharge sweeping the field IS the clip. The old script filmed a second,
    // separately posed discharge after the checks; that is unnecessary now, because
    // the wave the assertions read is the wave on screen — and it is the wave that
    // has the formation drone still standing in it afterwards, which is the half of
    // the behavior the old clip did not show at all.
    async act(api) {
      // A beat on the arranged field, so the reviewer can tell the formation drone
      // from the two divers before the wave reaches any of them.
      await api.advance(LEAD_IN_TICKS);

      await api.call("discharge");
      await api.advance(60); // 60 ticks = the old 0.5 s: the wave expands across the field
      snap = await api.snapshot();

      // Hold after the sweep so the reviewer sees the aftermath — an empty field
      // with the formation intact — rather than cutting at the wave's edge.
      await api.advance(108); // 108 ticks = the old 900 ms
    },

    async assert(api, check) {
      const survivor = findDrone(snap, formId);
      check.expectOk(
        "the formation drone survives the discharge",
        survivor !== null,
      );
      if (survivor)
        check.expectEq(
          "the survivor is still in formation",
          survivor.phase,
          "formation",
        );
      check.expectEq(
        "every diving drone is wiped",
        snap.drones.filter((d) => d.phase === "diving").length,
        0,
      );
      check.expectEq(
        "all enemy bullets are cleared",
        enemyBullets(snap).length,
        0,
      );
    },
  };
}
