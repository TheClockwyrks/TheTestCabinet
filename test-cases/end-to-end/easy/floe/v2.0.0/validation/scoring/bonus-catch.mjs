// Automated validation for the Scoring item `bonus-catch`.
//
// A fish appears in an open bay from time to time; completing a crossing into the
// bay holding the fish scores an extra 200 points. A seeded run is stepped until
// the fish appears (read its bay), the critter climbs that bay's column, and the
// score delta of the real bay-filling hop includes the +200 bonus:
// 10 (row) + 50 (bay) + 2*floor(T) (time) + 200 (catch). See validation/_helpers.mjs.
//
// THE WAIT FOR THE FISH IS SKIPPED RATHER THAN FILMED. The fish is on the build's own
// timer (specs/gameplay.md: one appears about every 8 s), and waiting for it in `act`
// spent the whole clip budget before the crossing had even started — the recording
// was a critter standing still on the near shore for eight seconds, and then it ran
// out, so the catch it exists to show never got filmed at all. `api.skipUntil` runs
// exactly the same simulation to exactly the same state, instantly, in both passes
// (see packages/browser-driver/validation.mjs), so the verdict is unchanged and the
// clip opens with the fish already sitting in its bay and the critter about to climb
// for it.

import {
  startCrossing,
  poseClimb,
  actClimbByPress,
  BAY_LEFT,
} from "../_helpers.mjs";

// How long the clip keeps filming after the catch: enough for the score to land and
// the next crossing to start, so the +200 is visibly the result of the hop.
const TAIL_TICKS = 180; // 1.5 s

export default function item() {
  // The skip that waited for the fish, which bay it landed in, and the score either
  // side of the hop into it.
  let r;
  let fishBay;
  let fishBeforeHop;
  let before;
  let after;

  return {
    id: "scoring.bonus-catch",

    // Seed the run so the fish's bay is reproducible, skip forward to the fish
    // appearing, and build the corridor at whichever bay it chose. All of it is
    // instant in both passes, so `act` starts with the scenario already standing —
    // which is what `arrange` is for, and the corridor could not be built any earlier
    // because WHICH bay to build under is only known once the fish is out.
    async arrange(api) {
      await startCrossing(api, 7); // seeded, so the fish's bay is reproducible
      r = await api.skipUntil((s) => s.fishBay !== null, {
        max: 1440,
        poll: 12,
      }); // up to 12 s of the build's own fish timer, at a 0.1 s cadence
      fishBay = r.snap.fishBay;
      if (fishBay !== null) await poseClimb(api, BAY_LEFT[fishBay]);
    },

    // The crossing itself: the climb up the fish's column and the hop into its bay —
    // the catch the bonus is for, and the clip.
    async act(api) {
      await actClimbByPress(api, "ArrowUp", 2);
      await api.call("setTimer", 10); // seconds — poses the clock, not a tick count
      before = (await api.snapshot()).score;
      fishBeforeHop = (await api.snapshot()).fishBay;
      await api.call("press", "ArrowUp"); // fill the fish's bay
      await api.advance(24); // 0.2 s, long enough for the fill to resolve
      after = await api.snapshot();
      await api.advance(TAIL_TICKS);
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
