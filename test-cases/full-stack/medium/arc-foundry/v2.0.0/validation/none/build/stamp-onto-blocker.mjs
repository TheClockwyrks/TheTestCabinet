// Automated validation for build.stamp-onto-blocker: dropping a rock onto an existing blocker
// rerolls that blocker into a fresh candidate in place.
//
// A blocker is created the real way — an un-kept candidate hardens at wave start — then the
// wave is cleared to reopen the build phase, and a rock is stamped onto the blocker: its tile
// becomes a fresh candidate carrying the new roll.
//
// WHAT IS FILMED, AND WHY THE WAVE IS NO LONGER PART OF IT. The wave clear used to run inside the
// act on `actClearWave`, which advances in REAL time in the record pass. A wave walking itself
// out takes most of a minute, and the recording budget is eight seconds — so the clip was eight
// seconds of Wave 1 and the stamp, the only thing this item is about, happened after the camera
// had stopped or in the last instant before it did. Against the run implementations the reroll
// landed right at the edge of the clip, which is why a build that never rerolled at all looked
// the same on camera as one that did.
//
// The clear is the journey to the evidence rather than the evidence, so it moves to `arrange` on
// `skipClearWave`: the same simulation, the same reopened build phase, instant in both passes and
// filming nothing. The act is then the whole clip — the blocker sitting there, the rock coming
// down on it, and the fresh candidate it turns into.

import { startBuild, placeCandidate, towerAt, snap, skipClearWave, spawnControlled, SECOND } from "../_helpers.mjs";

// A beat on the hardened blocker before the stamp, so the tile a reviewer is asked to watch is on
// screen as a blocker first. Without it the reroll is the opening frame and there is no "before".
const LEAD_TICKS = 1.5 * SECOND;
// A moment after the stamp so the clip shows the rerolled tile, with a Spark walking to make
// clear the board is live.
const CLIP_TICKS = 2.5 * SECOND;

export default function item() {
  // The board when the build phase reopened, and again after the stamp.
  let reopened;
  let after;

  return {
    id: "build.stamp-onto-blocker",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);
      const keeper = await placeCandidate(api, "capacitor", 3, 2, 7); // near entry: clears the wave fast
      await placeCandidate(api, "capacitor", 1, 10, 7); // this un-kept rock will harden into a blocker
      await api.call("keep", keeper.id); // launches Wave 1; the (10,7) rock hardens
      await skipClearWave(api, { maxTicks: 200 * SECOND }); // reopen the build phase, filming nothing
      reopened = await snap(api);
    },

    async act(api) {
      await api.advance(LEAD_TICKS); // the blocker standing inert on the tile about to be stamped

      await api.call("setNextRoll", "coil", 2);
      await api.call("placeRock", 10, 7); // stamp onto the blocker
      after = await snap(api);

      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the un-kept rock is a blocker in the reopened build phase", towerAt(reopened, 10, 7).kind, "blocker");

      const t = towerAt(after, 10, 7);
      check.expectEq("stamping onto the blocker rerolled it into a candidate", t.kind, "candidate");
      check.expectEq("...carrying the new roll (coil)", t.type, "coil");
    },
  };
}
