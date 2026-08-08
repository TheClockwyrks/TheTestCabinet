// Automated validation for quality.auto-resolve-prefers-fresh: an un-targeted combine prefers
// consuming a fresh candidate over a standing tower.
//
// Two matching standing towers are built over two levels; a matching fresh candidate is then
// placed and an un-targeted combine committed from one standing tower. It must consume the
// FRESH candidate (which hardens into a blocker) and leave the OTHER standing tower intact.
//
// WHY THE TWO WAVES ARE NO LONGER IN THE ACT. Getting two standing towers onto the board takes
// two levels, and a level ends by clearing a wave. Those clears used to run inside the act on
// `actClearWave`, which advances in REAL time in the record pass — so the recording spent its
// whole budget watching Wave 1 and Wave 2 walk an undefended yard, and unwound before the
// combine, before the screenshot, and before the item's declared output was ever produced.
//
// That is not a hypothetical. Two of the three run implementations produced NO media for this
// item at all — recorded as "script did not produce declared output(s)", which reads as a broken
// debug API and failed the point — purely because their waves took longer to walk than the
// reference's did. The budget was raised to 30 s to paper over it, which only moved the
// threshold: the check was still resting on how fast an arbitrary build's Load happens to move.
//
// So both clears move to `arrange` on `skipClearWave`: the same real simulation, the same board
// at the end of it, instant in BOTH passes. Nothing about the verdict changes — the validate pass
// was always instant — and the record pass now reaches the act with its budget untouched, on
// every build, regardless of how its waves are paced.
//
// WHAT IS FILMED. The item's evidence used to be a still of the aftermath, which is a board of
// three pieces in states a reviewer has to take on trust: they cannot see which of the two
// standing towers was the initiator, nor that the third piece was a fresh candidate a moment ago
// rather than always a blocker. The claim is about a CHOICE between two things the fold could
// have eaten, so the clip shows both of them standing, the fresh roll landing beside them, and
// the fold taking the fresh one.

import { startBuild, placeCandidate, towerAt, snap, skipClearWave, SECOND } from "../_helpers.mjs";

// A beat on the two standing towers before anything fresh is placed, so the pair the fold could
// choose between is on screen as a pair.
const LEAD_TICKS = 1.5 * SECOND;
// A beat on the fresh candidate once it lands, so it reads as the third, expendable piece.
const FRESH_TICKS = 1.5 * SECOND;
// A beat on the board the fold left behind.
const TAIL_TICKS = 2.5 * SECOND;

export default function item() {
  // The initiator, and the board after the auto-resolved combine.
  let aId;
  let s;

  return {
    id: "quality.auto-resolve-prefers-fresh",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);

      // Level 1: a standing capacitor@3 (A), near the Entry so its wave clears quickly.
      const a = await placeCandidate(api, "capacitor", 3, 2, 7);
      aId = a.id;
      await api.call("keep", a.id);
      await skipClearWave(api, { maxTicks: 300 * SECOND });

      // Level 2: a second standing capacitor@3 (B).
      const b = await placeCandidate(api, "capacitor", 3, 6, 7);
      await api.call("keep", b.id);
      await skipClearWave(api, { maxTicks: 300 * SECOND });
    },

    async act(api) {
      await api.advance(LEAD_TICKS); // A and B standing, both matching, either one foldable

      // Level 3: a fresh matching candidate (C), then an un-targeted combine from A.
      await placeCandidate(api, "capacitor", 3, 10, 7);
      await api.advance(FRESH_TICKS);

      await api.call("setCombineSet", []); // no explicit set → auto-resolve
      await api.call("combine", aId);
      s = await snap(api);

      await api.advance(TAIL_TICKS); // the fresh roll consumed, the standing partner untouched
    },

    async assert(api, check) {
      check.expectEq("the initiator climbed a tier (A -> T4)", towerAt(s, 2, 7).quality, 4);
      check.expectEq("the fresh candidate was consumed (its footprint is now a blocker)", towerAt(s, 10, 7).kind, "blocker");
      check.expectEq("the OTHER standing tower was left intact (fresh preferred over standing)", towerAt(s, 6, 7).kind, "component");
      check.expectEq("...still at its original tier", towerAt(s, 6, 7).quality, 3);
    },
  };
}
