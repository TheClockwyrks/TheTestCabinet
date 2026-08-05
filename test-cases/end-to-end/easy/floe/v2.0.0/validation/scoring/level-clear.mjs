// Automated validation for the Scoring item `level-clear`.
//
// Clearing a level awards a bonus of one hundred points times the level, on top of
// the bay it was filled with. With four bays pre-filled, the critter climbs to just
// below the fifth bay and fills it; the score delta of that real hop is
// 10 (row) + 50 (bay) + 2*floor(T) (time) + 100*level (the clear). See _helpers.mjs.
//
// As in `scoring.bay`, the bonus-catch fish is folded into the expectation rather
// than assumed away: it drifts between open bays on the build's own seeded
// generator (specs/gameplay.md), so a fixed fish-free total would fail a correct
// build purely on where its RNG put the fish.

import {
  startCrossing,
  poseClimb,
  actClimbByPress,
  BAY_COL,
} from "../_helpers.mjs";

// The bay this check fills to clear the level, and the fish's award.
const BAY_INDEX = 4;
const FISH_BONUS = 200;

export default function item() {
  // The score just before the clearing hop, whether the fish was sitting in the bay
  // about to be filled, and the state just after the hop.
  let before;
  let fishInBay;
  let after;

  return {
    id: "scoring.level-clear",

    // Zero the score, pre-fill four bays so the fifth is the clearing one, and build
    // the safe corridor at its column with the critter at the foot.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setScore", 0);
      await api.call("setBays", [true, true, true, true, false]);
      await poseClimb(api, BAY_COL[BAY_INDEX]); // bay 4's column (see `BAY_COL`)
    },

    // The climb and the fill that clears the level — the crossing the bonus is for,
    // and the clip.
    async act(api) {
      await actClimbByPress(api, "ArrowUp", 2);
      await api.call("setTimer", 10); // seconds — poses the clock, not a tick count
      const pre = await api.snapshot();
      before = pre.score;
      fishInBay = pre.fishBay === BAY_INDEX;
      await api.call("press", "ArrowUp"); // fill the fifth bay -> clear the level
      await api.advance(24); // 0.2 s, long enough for the fill to resolve
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGt(
        "clearing a level scores more than a plain bay",
        after.score - before,
        80 + (fishInBay ? FISH_BONUS : 0),
      );
      // 10 (row) + 50 (bay) + 2*floor(T) (time) + 100*level (the clear), plus the fish's
      // +200 if it happened to be in this bay. With the timer set to exactly 10 and
      // exact stepping, the fill resolves before the timer decrements this step, so the
      // delta is an exact 180, or 380 with the fish.
      check.expectEq(
        "the clear adds row(10) + bay(50+time) + 100*level",
        after.score - before,
        10 + 50 + 2 * 10 + 100 * 1 + (fishInBay ? FISH_BONUS : 0),
      );
    },
  };
}
