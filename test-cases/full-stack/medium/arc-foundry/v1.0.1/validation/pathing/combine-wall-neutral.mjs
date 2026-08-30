// Automated validation for pathing.combine-wall-neutral: a combine consumes its partner in
// place — the footprint hardens into a blocker rather than opening — so the maze route is
// unchanged across the combine.
//
// Two matching candidates are placed as walls; the maze length is read, then they are
// combined. The route length must be unchanged, the initiator footprint holds the combined
// component, and the consumed partner is a blocker (still a wall).
//
// Placing the pair and reading the route are the arrange; the COMBINE is the behavior under
// test and is the act. Because the fold consumes a fresh candidate it is also the level's
// harvest, so the clip carries on into the wave and shows the Load taking the unchanged route.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

// A beat on the PAIR before the fold. The claim is that the maze is unchanged ACROSS the combine,
// which a reviewer can only judge by seeing the wall as it was and then as it is; the act used to
// open on the fold itself, so the two rocks were already one piece and a blocker before anyone
// was watching.
const LEAD_TICKS = 1 * SECOND;
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The pair to fold, the route before the fold, and the board after it.
  let aId;
  let bId;
  let lenBefore;
  let s1;

  return {
    id: "pathing.combine-wall-neutral",

    async arrange(api) {
      await startBuild(api);
      const a = await placeCandidate(api, "capacitor", 1, 6, 7);
      const b = await placeCandidate(api, "capacitor", 1, 6, 10);
      aId = a.id;
      bId = b.id;
      lenBefore = (await snap(api)).mazeLength;
    },

    async act(api) {
      await api.advance(LEAD_TICKS); // the pair standing as two walls, before the fold

      await api.call("setCombineSet", [aId, bId]);
      await api.call("combine", aId);
      s1 = await snap(api);

      // The assertions are already fixed on `s1`; this only lets the clip show the Load walking
      // the route the fold did not change.
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectClose("the combine left the maze route unchanged (wall-neutral)", s1.mazeLength, lenBefore, 0.001);
      check.expectEq("the initiator footprint holds the combined component", towerAt(s1, 6, 7).kind, "component");
      check.expectEq("...one tier higher", towerAt(s1, 6, 7).quality, 2);
      check.expectEq("the consumed partner hardened into a blocker in place (no hole)", towerAt(s1, 6, 10).kind, "blocker");
    },
  };
}
