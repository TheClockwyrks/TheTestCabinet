// Automated validation for the Polarity sub-item `mismatch-no-destroy`.
//
// A player shot whose band is OPPOSITE the drone's current band never destroys it
// (what else it does is the mode's business, specs/gameplay.md). The drone is posed
// and an opposite-band shot fired into it; the real collision consumes the bullet
// but the drone survives, still in formation. This holds in both modes (Sortie
// wastes the shot; Overload charges the drone) — neither destroys it.

import { startClean, spawnDrone, shootDrone, findDrone } from "../_helpers.mjs";

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
      await shootDrone(api, shardId, "magenta"); // opposite band
      // Advance well past the moment the shot reaches the drone; it must survive.
      // The old script expressed this as a `stepUntil` with a predicate that never
      // holds, which is just a fixed advance — so that is what it is now.
      await api.advance(48); // 48 ticks = the old 0.4 s
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
