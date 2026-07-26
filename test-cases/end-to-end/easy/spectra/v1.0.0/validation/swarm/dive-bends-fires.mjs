// Automated validation for the Swarm sub-item `dive-bends-fires`.
//
// A diving drone leaves the formation, bends its path toward the player's x as it
// descends, and fires while diving. A formation drone is posed off to one side and
// the ship parked at the far side; a REAL dive is launched (forceDive) and advanced
// — its x is read trending toward the ship, and its real fire is read as an enemy
// bullet appearing.

import {
  startClean,
  spawnDrone,
  findDrone,
  enemyBullets,
} from "../_helpers.mjs";

const ARM_TICKS = 6; // 6 ticks = the old 0.05 s to arm the dive systems

// The old sweep was 130 reads 0.02 s apart — a 2.6 s window. 0.02 s is 2.4 ticks,
// which the tick contract refuses rather than rounds, so the poll rounds DOWN to 2:
// it is a SAMPLING poll tracking the drone's minimum x and watching for its first
// shot, and reading more often can only find a lower x or an earlier bullet, never
// miss one a coarser sweep would have caught. The tick budget is set to 312 so the
// window stays the original 2.6 s (156 reads at 2 ticks).
const POLL_TICKS = 2;
const WINDOW_TICKS = 312;

export default function item() {
  // The drone, where its dive began, and what the sweep observed.
  let droneId;
  let startX;
  let divePhase;
  let minX;
  let firedEnemy = false;

  return {
    id: "swarm.dive-bends-fires",

    // The drone is posed to the RIGHT and the ship far to the LEFT, so "bends toward
    // the player" shows up as a fall in x that cannot be confused with the drone
    // simply descending.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipX", 300); // far to the left of the drone
      droneId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 900,
        y: 200,
        phase: "formation",
      });
    },

    // The dive IS the clip. The old script filmed a second, separately posed dive
    // after its checks; there is no need now, because the dive the assertions read
    // is the dive on screen.
    async act(api) {
      await api.advance(ARM_TICKS); // let the formation register (arms the dive systems)
      startX = findDrone(await api.snapshot(), droneId).x;
      await api.call("forceDive", droneId);
      divePhase = findDrone(await api.snapshot(), droneId).phase;

      // Advance the dive, tracking the closest the drone gets to the ship and
      // whether it fires. An explicit loop rather than `until`, because the sweep
      // accumulates on every sample and stops when the dive ENDS, which is a
      // condition about the drone leaving the diving phase rather than a target
      // state being reached.
      minX = startX;
      for (let spent = 0; spent < WINDOW_TICKS; spent += POLL_TICKS) {
        await api.advance(POLL_TICKS);
        const s = await api.snapshot();
        const d = findDrone(s, droneId);
        if (d && d.phase === "diving") minX = Math.min(minX, d.x);
        if (enemyBullets(s).length > 0) firedEnemy = true;
        if (d && d.phase !== "diving") break;
      }
    },

    async assert(api, check) {
      check.expectEq("the drone enters a dive", divePhase, "diving");
      check.expectLt(
        "the dive bends toward the player's x",
        minX,
        startX - 100,
      );
      check.expectOk("the diver fires while diving", firedEnemy);
    },
  };
}
