// Automated validation for the base variant's Mode sub-item `mode.mismatch-wasted`.
//
// In Sortie a mismatched (wrong-band) shot is simply wasted: the bullet is consumed
// and the drone is unchanged — still alive, still in formation, neither redirected
// nor otherwise altered. A formation Shard is posed and hit with an opposite-band
// shot; the real collision consumes the shot and leaves the drone exactly as it was.

import { startClean, spawnDrone, findDrone, shootDrone } from "../_helpers.mjs";

export default function item() {
  // The Shard, and its state once the wasted shot has resolved.
  let shardId;
  let after;

  return {
    id: "mode.mismatch-wasted",

    // One formation Shard on an empty field, so the drone read back below can only
    // be the one that was shot.
    async arrange(api) {
      await startClean(api);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
    },

    async act(api) {
      await shootDrone(api, shardId, "magenta"); // opposite the drone's band
      await api.advance(36); // 36 ticks = the old 0.3 s: the shot reaches the drone and is resolved
      after = findDrone(await api.snapshot(), shardId);

      // Hold on the survivor so the clip shows the drone sitting unchanged in
      // formation afterwards — "nothing happened" is the behavior under test, and it
      // only reads as such if there is a moment of nothing to watch.
      await api.advance(108); // 108 ticks = the old 900 ms
    },

    async assert(api, check) {
      check.expectOk("the drone survives the wasted shot", after !== null);
      if (after) {
        check.expectEq("the drone keeps its band", after.band, "cyan");
        check.expectEq(
          "the drone stays in formation (no redirect)",
          after.phase,
          "formation",
        );
      }
    },
  };
}
