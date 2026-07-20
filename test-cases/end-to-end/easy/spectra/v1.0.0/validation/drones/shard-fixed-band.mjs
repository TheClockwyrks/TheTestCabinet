// Automated validation for the Drones sub-item `shard-fixed-band`.
//
// A Shard keeps a single fixed band for its whole life; it never changes. A Shard
// is posed and the real simulation stepped across several seconds; its band is read
// back at each sample and must never change.

import { startClean, spawnDrone, findDrone } from "../_helpers.mjs";

const SAMPLES = 10;
const SAMPLE_TICKS = 60; // 60 ticks = the old 0.5 s between reads

export default function item() {
  // The Shard, its band at spawn, and what the sweep saw.
  let shardId;
  let startBand;
  let everChanged = false;
  let samples = 0;

  return {
    id: "drones.shard-fixed-band",

    // One Shard on an empty field, its band read instantly at spawn. Lives are
    // padded so a dive of its own during the five-second sweep cannot end the run
    // and cut the sweep short — which would look like the drone "changing".
    async arrange(api) {
      await startClean(api);
      await api.call("setLives", 9);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
      });
      startBand = findDrone(await api.snapshot(), shardId).band;
    },

    // An explicit loop rather than `until`: the old sweep counted its samples and
    // broke when the drone left the field, and `until` evaluates its predicate once
    // before stepping at all, which would credit an extra sample at t=0.
    async act(api) {
      for (let i = 0; i < SAMPLES; i += 1) {
        await api.advance(SAMPLE_TICKS);
        const d = findDrone(await api.snapshot(), shardId);
        if (!d) break;
        samples += 1;
        if (d.band !== "cyan") everChanged = true;
      }
    },

    async assert(api, check) {
      check.expectEq("the Shard starts on its band", startBand, "cyan");
      check.expectGt("the Shard persisted across the sweep", samples, 4);
      check.expectOk("the Shard never changed band", everChanged === false);
    },
  };
}
