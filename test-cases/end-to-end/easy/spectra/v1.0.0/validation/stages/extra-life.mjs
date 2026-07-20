// Automated validation for the Stages sub-item `extra-life`.
//
// Crossing 20000 points awards one extra life, once; a later crossing awards no
// further life. The score is posed just below 20000 and a REAL matching kill crosses
// it (the award happens in the real scoring path, not fabricated); a later kill,
// already past the threshold, adds no life. A spare drone is kept alive so clearing
// a target does not end the wave.

import { startClean, spawnDrone, shootDrone, findDrone } from "../_helpers.mjs";

const KILL_MAX_TICKS = 60; // 60 ticks = the old 0.5 s cap on a kill resolving

export default function item() {
  // The first target, and the state after each of the two kills.
  let firstId;
  let a;
  let b;

  return {
    id: "stages.extra-life",

    // The score is posed just under the threshold so a single real kill crosses it
    // through the real scoring path. A keepalive drone sits far from the target lane
    // and is never shot, so destroying a target never empties the field (which would
    // end the wave and cut the second half of the check short).
    async arrange(api) {
      await startClean(api);
      await api.call("setLives", 3);
      await api.call("setScore", 19950); // a formation Shard kill (+50) crosses 20000
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 250,
        y: 200,
        phase: "formation",
      });
      firstId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
    },

    async act(api) {
      await shootDrone(api, firstId, "cyan");
      a = await api.until((s) => findDrone(s, firstId) === null, {
        max: KILL_MAX_TICKS,
      });

      // A later crossing (already past 20000) awards no further life. The second
      // target is posed with `spawnDrone` — a control op, so no reset is needed and
      // the clock is never taken back.
      const secondId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      await shootDrone(api, secondId, "cyan");
      b = await api.until((s) => findDrone(s, secondId) === null, {
        max: KILL_MAX_TICKS,
      });

      // The capture shows the HUD holding four lives after two kills across the
      // threshold. `settle` is a real pause in both passes and the only thing that
      // paints a frame in the validate pass.
      await api.settle(120);
      await api.screenshot("extra-life");
    },

    async assert(api, check) {
      check.expectGe("the score crossed 20000", a.snap.score, 20000);
      check.expectEq("crossing 20000 awards one extra life", a.snap.lives, 4);
      check.expectEq(
        "a later crossing awards no further life",
        b.snap.lives,
        4,
      );
    },
  };
}
