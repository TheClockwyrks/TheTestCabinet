// Automated validation for the Polarity sub-item `match-destroys`.
//
// A player shot whose band matches the drone's current band destroys it. The
// drone is posed (a precondition); the real collision, run forward by advancing the
// real simulation, is what destroys it — the outcome is read back from snapshot().
//
// The shot is fired from the ship's lane rather than posed on the drone, so the
// kill the assertion reads is the same kill the clip shows: the drone holds
// formation, a bullet rises into it, and it pops. The old script posed the bullet on
// the drone, killing it on the first tick — which cleared the wave, so the
// "watchable restatement" that followed was filmed over the STAGE 1 CLEARED
// interstitial and never appeared at all (see `LEAD_IN_TICKS`).

import {
  startClean,
  holdDrones,
  spawnDrone,
  spawnBystander,
  shootFromLane,
  readsAs,
  findDrone,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// Room for a shot to cross the ~280 px up to the drone (0.37 s at the specified
// bullet speed), with slack for a build whose bullets are slower.
const REACH_MAX_TICKS = 150;

export default function item() {
  // The drone under test and the moment it was destroyed.
  let shardId;
  let r;

  return {
    id: "polarity.match-destroys",

    // One formation Shard in the ship's column, plus a bystander off to the side so
    // the wave is not emptied by the kill (see `spawnBystander`). The drone that
    // disappears below is found by id, so it can only be the one that was shot.
    //
    // The swarm is held (`holdDrones`), so the Shard stands exactly where it was
    // posed for the whole scenario. The old script had it swaying and liable to be
    // peeled into a dive, and covered for that with `shootUntil`'s re-aiming
    // retries — up to four shots, the last posed on the drone. That made the
    // verdict rest on marksmanship as much as on the band rule. Held, ONE lane shot
    // up the drone's own column reaches it, so "the drone is gone" can only mean
    // the matching shot destroyed it.
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
      // A beat on the intact drone first, so the clip opens on the scene rather
      // than on the shot already having landed.
      await api.advance(LEAD_IN_TICKS);

      // Aimed by what the drone currently reads as rather than a hardcoded band —
      // the one thing a check about matching should ever aim by (see `readsAs`).
      await shootFromLane(api, shardId, readsAs(await api.snapshot(), shardId));
      r = await api.until((s) => findDrone(s, shardId) === null, {
        max: REACH_MAX_TICKS,
      });

      // Hold on the pop, so the clip ends on the burst and the wave carrying on.
      await api.advance(72); // 0.6 s of the burst playing out
    },

    async assert(api, check) {
      check.expectOk("a matching-band shot destroys the drone", r.hit);
    },
  };
}
