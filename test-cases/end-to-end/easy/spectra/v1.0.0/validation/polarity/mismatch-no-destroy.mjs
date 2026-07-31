// Automated validation for the Polarity sub-item `mismatch-no-destroy`.
//
// A player shot whose band is OPPOSITE the drone's current band never destroys it
// (what else it does is the mode's business, specs/gameplay.md). The drone is posed
// and an opposite-band shot fired into it; the real collision consumes the bullet
// but the drone survives, still in formation. This holds in both modes (Sortie
// wastes the shot; Overload charges the drone) — neither destroys it.

import {
  startClean,
  spawnDrone,
  shootDrone,
  shootFromLane,
  findDrone,
  friendlyBullets,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// Room for the shot to cross the ~280 px up to the drone and be consumed by it.
const REACH_MAX_TICKS = 150;

// Long enough for a shot posed on the drone to resolve.
const CONTACT_TICKS = 24;

export default function item() {
  // The drone under test and its state once the shot has resolved.
  let shardId;
  let after;

  return {
    id: "polarity.mismatch-no-destroy",

    // One formation Shard on an empty field, so its survival below is unambiguous.
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
      // A beat on the intact drone first, so the clip opens on the scene rather
      // than on the shot already having landed.
      await api.advance(LEAD_IN_TICKS);

      // One shot the reviewer can watch: fired from the ship's lane so it visibly
      // rises into the drone and fails to break it, which is the whole point of the
      // item and invisible when the bullet starts on top of its target.
      await shootFromLane(api, shardId, "magenta"); // opposite band
      await api.until((s) => friendlyBullets(s).length === 0, {
        max: REACH_MAX_TICKS,
      });

      // …and one posed ON the drone, which is what the verdict rests on. The item's
      // evidence is that nothing happened, and a lane shot that simply MISSED — the
      // formation sways while it is in flight — would leave the drone alive for
      // entirely the wrong reason. Posed, the contact is certain, so a surviving
      // drone can only mean the band rule held.
      await shootDrone(api, shardId, "magenta");
      await api.advance(CONTACT_TICKS);
      after = findDrone(await api.snapshot(), shardId);

      // Hold on the survivor: "the shot did not destroy it" only reads on film if
      // the drone is seen still sitting there afterwards.
      await api.advance(120); // 120 ticks = the old 1000 ms
    },

    async assert(api, check) {
      check.expectOk(
        "the drone survives an opposite-band shot",
        after !== null,
      );
      if (after) {
        check.expectEq("the drone keeps its band", after.band, "cyan");
        check.expectEq(
          "the drone stays in formation",
          after.phase,
          "formation",
        );
      }
    },
  };
}
