// Automated validation for the Polarity sub-item `discharge-clears`.
//
// At full resonance a discharge wipes every entering and diving drone and clears
// all enemy bullets (band-blind), but spares the formation. Divers, a formation
// drone, and enemy bullets are posed, the meter filled, and a REAL discharge fired;
// the expanding wave, stepped forward, resolves what it clears and what it spares.

import {
  startClean,
  spawnDrone,
  findDrone,
  enemyBullets,
} from "../_helpers.mjs";

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
      await api.call("spawnEnemyBullet", { x: 640, y: 400, band: "cyan" });
      await api.call("spawnEnemyBullet", { x: 520, y: 320, band: "magenta" });
      await api.call("setResonance", 100);
    },

    // The discharge sweeping the field IS the clip. The old script filmed a second,
    // separately posed discharge after the checks; that is unnecessary now, because
    // the wave the assertions read is the wave on screen — and it is the wave that
    // has the formation drone still standing in it afterwards, which is the half of
    // the behavior the old clip did not show at all.
    async act(api) {
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
