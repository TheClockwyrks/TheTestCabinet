// Automated validation for the Scoring item `bay`.
//
// Reaching a bay scores fifty points plus a per-second bonus for the time left on
// the crossing timer. The critter climbs a safe corridor to just below a bay (so
// bestRow tracks naturally), the timer is set to a known value, and the score
// delta of the real bay-filling hop is read back: 10 (final row) + 50 + 2*floor(T).
// See validation/_helpers.mjs.

import { startCrossing, poseClimb, actClimbByPress } from "../_helpers.mjs";

export default function item() {
  // The score just before the bay-filling hop, and the state just after it.
  let before;
  let after;

  return {
    id: "scoring.bay",

    // Zero the score so the award reads as a clean delta, then build the safe corridor
    // at bay 1's column with the critter at its foot. Posing only — the climb itself
    // consumes time and so belongs in `act`.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setScore", 0);
      await poseClimb(api, 11); // bay 1 column
    },

    // The real climb up the corridor and the bay-filling hop at the top — the whole
    // crossing that earns the score, which is exactly what the clip should show.
    async act(api) {
      await actClimbByPress(api, "ArrowUp", 2); // climb to just below the bay
      await api.call("setTimer", 10); // seconds — poses the clock, not a tick count
      before = (await api.snapshot()).score;
      await api.call("press", "ArrowUp"); // fill bay 1
      await api.advance(24); // 0.2 s, long enough for the fill to resolve
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the crossing filled bay 1", after.bays[1], true);
      // 10 (row) + 50 (bay) + 2*floor(T) (time). With the timer set to exactly 10 and
      // exact stepping, the fill resolves before the timer decrements this step, so the
      // time term is exactly 2*10 — the delta is an exact 80.
      check.expectEq(
        "a bay scores row(10) + 50 + a per-second time bonus",
        after.score - before,
        10 + 50 + 2 * 10,
      );
    },
  };
}
