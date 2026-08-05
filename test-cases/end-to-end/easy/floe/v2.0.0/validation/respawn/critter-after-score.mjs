// Automated validation for the Respawn item `critter-after-score`.
//
// After completing a crossing into a bay (without clearing the level), a fresh
// critter respawns on the near shore — on solid footing, with the crossing timer
// reset for the next crossing (specs/gameplay.md, specs/playfield.md). The critter is
// hopped into one open bay of five, then the respawn is read back: WHERE the fresh
// critter comes back. The bear's matching fairness is `hunter.fair-reset-bay`. See
// validation/_helpers.mjs.

import {
  startCrossing,
  ROW_BAYS,
  ROW_NEAR,
  TICK,
  WATER_TOP,
} from "../_helpers.mjs";

// Bay index 2, entered from the top water row at the column its opening straddles
// under either reading of specs/playfield.md's layout (see `BAY_COL` in the helpers,
// whose value for this bay is 20). The other four bays stay open, so this is a
// between-crossings respawn rather than a level clear.
const BAY_INDEX = 2;
const COL = 20;

// How long the critter is filmed riding up to the bay before it hops in, and how
// long the clip keeps rolling once it is back on the near shore. The item is about
// WHERE the fresh critter comes back, and the sweep ends on the tick it arrives —
// so without a tail the clip was a critter in a bay and then a cut, which is the
// half of the behavior that was never in question. The tail is what shows the
// respawn; the lead-in is what shows the crossing it was earned by.
const LEAD_TICKS = 60; // 0.5 s
const TAIL_TICKS = 240; // 2 s

export default function item() {
  // The bay fill and the respawn it produced, for `assert` to read.
  let filled;
  let r;

  return {
    id: "respawn.critter-after-score",

    // Pose a crossing one hop from completion: the critter on a parked floe in the top
    // water row directly below an open bay, the bays otherwise empty.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", WATER_TOP, { cols: [COL], speed: 0 }); // floe under the bay
      await api.call("placeCritter", COL, WATER_TOP);
    },

    // The bay fill and the respawn it triggers — both what is checked and the clip.
    async act(api) {
      await api.advance(LEAD_TICKS); // the critter waiting under the open bay
      await api.call("press", "ArrowUp");
      filled = await api.until((s) => s.bays[BAY_INDEX] === true, {
        max: 60,
        poll: 1,
      });
      // THE SWEEP MUST NOT LOOK FOR THE ANSWER. It used to wait for
      // `phase === "crossing" && critter.row === ROW_NEAR` and then assert that the
      // row was ROW_NEAR — the very fact it had searched for, so the assertion could
      // not fail on its own terms. Against a build that begins the fresh crossing in
      // the middle of the road the sweep simply ran out, and the verdict blamed "a
      // fresh crossing begins after the bay", which is a false diagnosis of a build
      // whose crossing began perfectly well in the wrong place. It now marks the fresh
      // crossing by something that says nothing about position, and every assertion
      // below reads a fact the predicate did not. (`respawn.critter-after-death` makes
      // the same point at greater length.)
      r = await api.until(
        (s) =>
          s.screen === "playing" &&
          s.phase === "crossing" &&
          s.critter.row !== ROW_BAYS,
        { max: 300, poll: TICK }, // 2.5 s — covers the brief bay-fill pause
      );
      await api.advance(TAIL_TICKS); // the fresh critter waiting on the near shore
    },

    async assert(api, check) {
      check.expectOk("the crossing completes into a bay", filled.hit);
      check.expectOk("a fresh crossing begins after the bay", r.hit);
      check.expectEq(
        "the critter respawns on the near shore",
        r.snap.critter.row,
        ROW_NEAR,
      );
      check.expectEq(
        "the critter respawns on solid footing",
        r.snap.critter.footing,
        "solid",
      );
      check.expectEq(
        "one bay filled, the level not cleared",
        r.snap.bays.filter(Boolean).length,
        1,
      );
      check.expectEq("still on the same level", r.snap.level, 1);
      check.expectGt(
        "the crossing timer is reset for the next crossing",
        r.snap.timer,
        r.snap.timerMax - 1,
      );
    },
  };
}
