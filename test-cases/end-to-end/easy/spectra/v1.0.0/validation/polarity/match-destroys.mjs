// Automated validation for the Polarity sub-item `match-destroys`.
//
// A player shot whose band matches the drone's current band destroys it. The
// drone is posed (a precondition); the real collision, run forward by advancing the
// real simulation, is what destroys it — the outcome is read back from snapshot().

import { startClean, spawnDrone, shootDrone, findDrone } from "../_helpers.mjs";

export default function item() {
  // The drone under test and the moment it was destroyed.
  let shardId;
  let r;

  return {
    id: "polarity.match-destroys",

    // One formation Shard on an empty field, so the drone that disappears below can
    // only be the one that was shot.
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
      await shootDrone(api, shardId, "cyan"); // matching band
      r = await api.until((s) => findDrone(s, shardId) === null, { max: 60 }); // 60 ticks = the old 0.5 s

      // `shootDrone` poses the bullet ON the drone, which is exact for the check but
      // resolves in a couple of frames — nothing a reviewer can see. Restate the
      // SAME check watchably: a fresh drone with a real bullet rising into it from
      // the ship's lane, exactly as the old script's clip tail did, but posed with
      // control ops (`clearField` + spawns) because `reset` in `act` would take the
      // clock back and freeze the recording. The verdict is already decided above.
      await api.call("clearField");
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      await api.call("spawnPlayerBullet", { x: 640, y: 540, band: "cyan" });
      await api.advance(144); // 144 ticks = the old 1200 ms: the shot rises and pops it
    },

    async assert(api, check) {
      check.expectOk("a matching-band shot destroys the drone", r.hit);
    },
  };
}
