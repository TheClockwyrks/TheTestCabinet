// Automated validation for the Scoring item `bonus-catch`.
//
// A fish appears in an open bay from time to time; completing a crossing into the
// bay holding the fish scores an extra 200 points. A seeded run is stepped until
// the fish appears (read its bay), the critter climbs that bay's column, and the
// score delta of the real bay-filling hop includes the +200 bonus:
// 10 (row) + 50 (bay) + 2*floor(T) (time) + 200 (catch). See validation/_helpers.mjs.

import {
  startCrossing,
  poseClimb,
  actClimbByPress,
  BAY_LEFT,
} from "../_helpers.mjs";

export default function item() {
  // The sweep that waited for the fish, which bay it landed in, and the score either
  // side of the hop into it.
  let r;
  let fishBay;
  let fishBeforeHop;
  let before;
  let after;

  return {
    id: "scoring.bonus-catch",

    // Seed the run so the fish's bay is reproducible. Everything after this depends on
    // WHICH bay the fish picks, which is only known once time has run — so the corridor
    // is built inside `act`, with `poseClimb` (control ops only, no reset).
    async arrange(api) {
      await startCrossing(api, 7); // seeded, so the fish's bay is reproducible
    },

    // Wait for the fish, then climb its bay's column and complete the crossing into
    // it — the catch the bonus is for, and the clip.
    async act(api) {
      r = await api.until((s) => s.fishBay !== null, { max: 1440, poll: 12 }); // 12 s at 0.1 s
      fishBay = r.snap.fishBay;

      await poseClimb(api, BAY_LEFT[fishBay]); // climb the fish's bay column
      await actClimbByPress(api, "ArrowUp", 2);
      await api.call("setTimer", 10); // seconds — poses the clock, not a tick count
      before = (await api.snapshot()).score;
      fishBeforeHop = (await api.snapshot()).fishBay;
      await api.call("press", "ArrowUp"); // fill the fish's bay
      await api.advance(24); // 0.2 s, long enough for the fill to resolve
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk("a bonus-catch fish appears in an open bay", r.hit);
      check.expectEq(
        "the fish is still in its bay before the hop",
        fishBeforeHop,
        fishBay,
      );
      check.expectEq(
        "the crossing filled the fish's bay",
        after.bays[fishBay],
        true,
      );
      // 10 (row) + 50 (bay) + 2*floor(T) (time) + 200 (catch). With the timer set to
      // exactly 10 and exact stepping, the fill resolves before the timer decrements
      // this step, so the delta is an exact 280.
      check.expectEq(
        "landing in the fish's bay adds a +200 bonus",
        after.score - before,
        10 + 50 + 2 * 10 + 200,
      );
    },
  };
}
