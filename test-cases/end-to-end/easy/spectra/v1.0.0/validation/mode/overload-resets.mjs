// Automated validation for the overload variant's Mode sub-item `mode.overload-resets`.
//
// When a drone reaches three charge it overloads (performing its per-type reaction)
// and its charge resets to zero. A Shard is posed at two charge (a precondition via
// setDroneCharge); one more real mismatched shot tips it to three, which overloads
// it — its charge is read back at zero and its reaction (a Shard leaving formation
// to dive) confirmed.

import { startClean, spawnDrone, findDrone, shootDrone } from "../_helpers.mjs";

const DIVE_MAX_TICKS = 60; // 60 ticks = the old 0.5 s cap on the reaction launching

export default function item() {
  // The Shard, and its state once the overload has fired.
  let shardId;
  let after;

  return {
    id: "mode.overload-resets",

    // One Shard posed one charge short of overloading, so a single real mismatched
    // shot is what tips it over — the tipping hit is a real collision, not a setter.
    async arrange(api) {
      await startClean(api);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      await api.call("setDroneCharge", shardId, 2); // one short of overloading
    },

    async act(api) {
      await shootDrone(api, shardId, "magenta"); // the tipping wrong-band hit
      await api.until(
        (s) => {
          const d = findDrone(s, shardId);
          return d !== null && d.phase === "diving";
        },
        { max: DIVE_MAX_TICKS },
      );
      after = findDrone(await api.snapshot(), shardId);

      // Let the dive run so the clip shows the reaction the assertions name — a
      // Shard leaving formation and plunging — rather than the single frame it
      // starts on.
      await api.advance(144); // 144 ticks = the old 1200 ms
    },

    async assert(api, check) {
      check.expectOk(
        "the overloaded drone is still on the field",
        after !== null,
      );
      if (after) {
        check.expectEq(
          "the charge resets to zero after overloading",
          after.charge,
          0,
        );
        check.expectEq(
          "the Shard's overload reaction sends it diving",
          after.phase,
          "diving",
        );
      }
    },
  };
}
