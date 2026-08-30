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
// WHAT IS FILMED. Four of the five stamps used to be spent in `arrange`, which is instant in both
// passes, so the recording opened on a board that already held four rolled candidates and only
// the fifth landed on camera. The claim is about the SPREAD across repeated drops — that each one
// rolls its own component as it lands — and a clip showing one drop onto a board of finished rolls
// cannot depict a spread at all.
//
// So all five are dropped in the act, a beat apart. A placement consumes no game time, which is
// why they could live in `arrange`; a beat between them is what makes the sequence legible as
// five separate rolls rather than one frame in which a board appears. The clip is then the press
// being pulled five times and handing out five different components.

import { startBuild, towerAt, snap, spawnControlled, SPOTS, SECOND } from "../_helpers.mjs";

// A beat between drops, so each roll lands and reads before the next one does.
const BEAT_TICKS = 0.9 * SECOND;
// Long enough after the last drop for the landed candidate to read clearly, with a released Spark
// walking to show the board is live rather than a still.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The distinct types the drops rolled, read by `assert`.
  const types = new Set();

  return {
    id: "build.roll-on-placement",

    async arrange(api) {
      await startBuild(api, { seed: 1 });
    },

    async act(api) {
      // One seeded run, the real press: spend the whole five-stamp allowance a beat at a time and
      // read each drop. A per-drop roll yields a spread from one stream; a fixed / at-press roll
      // would not.
      for (const spot of SPOTS) {
        await api.call("setNextRoll", null); // clear the arming: roll the real seeded press
        await api.call("placeRock", spot.col, spot.row);
        const t = towerAt(await snap(api), spot.col, spot.row);
        if (t && t.kind === "candidate") types.add(t.type);
        await api.advance(BEAT_TICKS);
      }

      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectGt("placements roll a spread of component types on landing", types.size, 1);
    },
  };
}
