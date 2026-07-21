// Automated validation for the Swarm sub-item `dive-returns`.
//
// A drone that survives its dive returns to its formation slot (phase returning,
// then formation back at its slot) rather than vanishing. A formation drone is
// posed, a REAL dive launched, and the real motion systems advanced until the drone
// loops back and re-settles.

import { startClean, spawnDrone, findDrone } from "../_helpers.mjs";

const ARM_TICKS = 6; // 6 ticks = the old 0.05 s to arm the dive systems
const LOOP_MAX_TICKS = 720; // 720 ticks = the old 6 s cap on each leg of the loop

export default function item() {
  // The drone and the two milestones of its round trip.
  let droneId;
  let ret;
  let home;

  return {
    id: "swarm.dive-returns",

    // One drone on an empty field, so the drone that loops back can only be this one
    // and its slot is unambiguous.
    async arrange(api) {
      await startClean(api);
      droneId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
      });
    },

    // The whole round trip — dive out, loop back, re-settle — which is both what the
    // assertions read and precisely what the reviewer has to watch to judge it.
    async act(api) {
      await api.advance(ARM_TICKS);
      await api.call("forceDive", droneId);

      // The drone loops back: it enters the returning phase, then re-settles.
      ret = await api.until(
        (s) => {
          const d = findDrone(s, droneId);
          return d !== null && d.phase === "returning";
        },
        { max: LOOP_MAX_TICKS },
      );

      home = await api.until(
        (s) => {
          const d = findDrone(s, droneId);
          return d !== null && d.phase === "formation";
        },
        { max: LOOP_MAX_TICKS },
      );
    },

    async assert(api, check) {
      check.expectOk("the diver enters the returning phase", ret.hit);
      check.expectOk("the diver re-settles into formation", home.hit);
      const d = findDrone(home.snap, droneId);
      if (d) check.expectClose("it returns to its slot y", d.y, d.slotY, 1);
    },
  };
}
