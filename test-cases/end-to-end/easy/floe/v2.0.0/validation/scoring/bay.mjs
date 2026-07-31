// Automated validation for the Scoring item `bay`.
//
// Reaching a bay scores fifty points plus a per-second bonus for the time left on
// the crossing timer. The critter climbs a safe corridor to just below a bay (so
// bestRow tracks naturally), the timer is set to a known value, and the score
// delta of the real bay-filling hop is read back: 10 (final row) + 50 + 2*floor(T).
// See validation/_helpers.mjs.
//
// The bonus-catch fish is folded into the expectation rather than assumed away.
// The fish drifts between open bays on the build's OWN seeded generator
// (specs/gameplay.md), so which bay holds it when the climb finishes is an
// implementation's own business — pinning the delta to a fish-free 80 would fail a
// perfectly correct build purely on where its RNG put the fish. `fishBay` is read
// from the snapshot taken immediately before the filling hop and its `+200`
// (specs/gameplay.md) added when it names the bay being filled. The fish bonus
// itself is `scoring.bonus-catch`'s item, not this one.

import { startCrossing, poseClimb, actClimbByPress } from "../_helpers.mjs";

// The bay this check fills, and the bonus-catch fish's award (specs/gameplay.md).
const BAY_INDEX = 1;
const FISH_BONUS = 200;

export default function item() {
  // The score just before the bay-filling hop, whether the fish was sitting in the
  // bay about to be filled, and the state just after the hop.
  let before;
  let fishInBay;
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
      const pre = await api.snapshot();
      before = pre.score;
      fishInBay = pre.fishBay === BAY_INDEX;
      await api.call("press", "ArrowUp"); // fill bay 1
      await api.advance(24); // 0.2 s, long enough for the fill to resolve
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the crossing filled bay 1", after.bays[BAY_INDEX], true);
      // 10 (row) + 50 (bay) + 2*floor(T) (time), plus the fish's +200 if it happened to
      // be in this bay. With the timer set to exactly 10 and exact stepping, the fill
      // resolves before the timer decrements this step, so the time term is exactly
      // 2*10 — the delta is an exact 80, or 280 with the fish.
      check.expectEq(
        "a bay scores row(10) + 50 + a per-second time bonus",
        after.score - before,
        10 + 50 + 2 * 10 + (fishInBay ? FISH_BONUS : 0),
      );
    },
  };
}
