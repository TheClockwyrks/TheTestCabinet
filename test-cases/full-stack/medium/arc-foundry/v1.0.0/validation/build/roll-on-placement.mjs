// Automated validation for build.roll-on-placement: a rock rolls its component on placement
// (when it lands), not when the press is pulled.
//
// With the debug arming cleared (the real seeded press), a rock is placed under several
// different seeds; the placed candidate carries a rolled type, and the spread across seeds
// shows the roll is drawn at the drop (a deterministic function of the seed and the drop),
// not a fixed value.
//
// The re-seeding sweep resets the run ten times, which only `arrange` may do — and it consumes
// no game time, so it belongs there anyway. The act then performs one more real roll on the
// board the sweep left standing: a rock landing and revealing its type IS the checked behavior,
// so that is what the clip depicts (the old tail merely walked a Spark past the board, which
// showed nothing about when a roll happens).

import { startBuild, towerAt, snap, spawnControlled, SECOND } from "../_helpers.mjs";

// Long enough after the drop for the landed candidate to read clearly, with a released Spark
// walking to show the board is live rather than a still.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The distinct types the re-seeded sweep rolled, read by `assert`.
  const types = new Set();

  return {
    id: "build.roll-on-placement",

    async arrange(api) {
      for (let seed = 1; seed <= 10; seed += 1) {
        await startBuild(api, { seed });
        await api.call("setNextRoll", null); // clear the arming: roll the real seeded press
        await api.call("placeRock", 6, 7);
        const t = towerAt(await snap(api), 6, 7);
        if (t && t.kind === "candidate") types.add(t.type);
      }
    },

    async act(api) {
      // One more real roll, landed on camera: the type is drawn at the drop.
      await api.call("setNextRoll", null);
      await api.call("placeRock", 10, 7);
      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectGt("re-seeded placements roll a spread of component types on landing", types.size, 1);
    },
  };
}
