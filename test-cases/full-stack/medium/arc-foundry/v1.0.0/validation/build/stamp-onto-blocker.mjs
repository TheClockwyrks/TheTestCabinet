// Automated validation for build.stamp-onto-blocker: dropping a rock onto an existing blocker
// rerolls that blocker into a fresh candidate in place.
//
// A blocker is created the real way — an un-kept candidate hardens at wave start — then the
// wave is cleared to reopen the build phase, and a rock is stamped onto the blocker: its tile
// becomes a fresh candidate carrying the new roll.
//
// Standing up the keeper and the doomed rock is all control ops (the arrange). Clearing the
// wave consumes time, so it and the stamp that follows it are the act — which is right, because
// the stamp is the behavior under test and can only happen once the build phase reopens.

import { startBuild, placeCandidate, towerAt, snap, actClearWave, spawnControlled, SECOND } from "../_helpers.mjs";

// A moment after the stamp so the clip shows the rerolled tile, with a Spark walking to make
// clear the board is live.
const CLIP_TICKS = 2 * SECOND;

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
    },

    async act(api) {
      await actClearWave(api, { maxTicks: 200 * SECOND }); // reopen the build phase
      reopened = await snap(api);

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
