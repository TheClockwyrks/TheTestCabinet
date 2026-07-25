// Automated validation for build.roll-on-placement: a rock rolls its component on placement
// (when it lands), not when the press is pulled (specs/build.md §"The stamp").
//
// With the debug arming cleared (the real seeded press), several rocks are placed within one
// run and each landed candidate carries a rolled type; the spread across the drops shows the
// roll is drawn per-drop from the live press, not a fixed value. The variety is read from
// REPEATED drops off one press stream rather than one drop per consecutive seed, so the check
// does not assume adjacent seeds decorrelate (a seedable-but-unhashed generator is
// spec-compliant, and its within-run draws are still uniform).
//
// The placements consume no game time, so they belong to `arrange` (the first four stamps). The
// act then performs one more real roll on camera: a rock landing and revealing its type IS the
// checked behavior, so that is what the clip depicts.

import { startBuild, towerAt, snap, spawnControlled, SPOTS, SECOND } from "../_helpers.mjs";

// Long enough after the drop for the landed candidate to read clearly, with a released Spark
// walking to show the board is live rather than a still.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The distinct types the drops rolled, read by `assert`.
  const types = new Set();

  return {
    id: "build.roll-on-placement",

    async arrange(api) {
      // One seeded run, the real press: place the first four of the five-stamp allowance and
      // read each drop. A per-drop roll yields a spread from one stream; a fixed / at-press roll
      // would not.
      await startBuild(api, { seed: 1 });
      await api.call("setNextRoll", null); // clear the arming: roll the real seeded press
      for (let i = 0; i < 4; i += 1) {
        const spot = SPOTS[i];
        await api.call("placeRock", spot.col, spot.row);
        const t = towerAt(await snap(api), spot.col, spot.row);
        if (t && t.kind === "candidate") types.add(t.type);
      }
    },

    async act(api) {
      // The fifth stamp, landed on camera: the type is drawn at the drop.
      const spot = SPOTS[4];
      await api.call("setNextRoll", null);
      await api.call("placeRock", spot.col, spot.row);
      const t = towerAt(await snap(api), spot.col, spot.row);
      if (t && t.kind === "candidate") types.add(t.type);

      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectGt("placements roll a spread of component types on landing", types.size, 1);
    },
  };
}
