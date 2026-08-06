// Automated validation for the base variant's Mode sub-item `mode.mismatch-wasted`.
//
// In Sortie a mismatched (wrong-band) shot is simply wasted: the bullet is consumed
// and the drone is unchanged — still alive, still in formation, neither redirected
// nor otherwise altered. A formation Shard is posed and hit with an opposite-band
// shot; the real collision consumes the shot and leaves the drone exactly as it was.

import {
  startClean,
  holdDrones,
  spawnDrone,
  spawnBystander,
  findDrone,
  shootFromLane,
  friendlyBullets,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// Room for the shot to cross the ~280 px up to the drone and be consumed by it.
const REACH_MAX_TICKS = 150;

export default function item() {
  // The Shard, and its state once the wasted shot has resolved.
  let shardId;
  let after;

  return {
    id: "mode.mismatch-wasted",

    // One formation Shard, held still (`holdDrones`) so it stands where it was
    // posed and a lane shot up its own column cannot miss it — "the drone is
    // unchanged" is the whole verdict here, and a shot that sailed past a swaying
    // drone would look exactly the same. A bystander well off to the side keeps the
    // wave live.
    async arrange(api) {
      await startClean(api);
      await holdDrones(api);
      await spawnBystander(api);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
    },

    async act(api) {
      // A beat on the intact drone, so the clip opens on the scene.
      await api.advance(LEAD_IN_TICKS);

      // Fired from the ship's lane so the reviewer watches it rise into the drone
      // and be swallowed; the bullet being consumed is the contact.
      await shootFromLane(api, shardId, "magenta"); // opposite the drone's band
      await api.until((s) => friendlyBullets(s).length === 0, {
        max: REACH_MAX_TICKS,
      });
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
