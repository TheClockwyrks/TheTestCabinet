// Automated validation for the Hunter item `pursues`.
//
// The bear pursues the critter's position: over time the distance between them
// shrinks. The critter is fixed on the median and a bear placed a few tiles away;
// the real pursuit brain closes the gap as the simulation steps, which the
// snapshots read back. See validation/_helpers.mjs.

// IT FOLLOWS THE CRITTER WHEREVER IT GOES. specs/hunter.md is explicit that the bear
// "has a position on the strait and it moves toward the critter, following it wherever
// it goes", and the one gate it describes is on EMERGING: a bear comes out once a fresh
// critter has advanced a few tiles off the near shore. Nothing suspends a bear that is
// already out. A build can satisfy the first measurement below and still stop hunting the
// moment the critter drops back toward the shore — one of the builds this case was
// audited against gates its entire hunter update on the critter being above a given row,
// so its bear freezes (and stops being subject to hazards, and stops catching) whenever
// the critter retreats. That is a dead hunt for the part of every crossing that begins on
// the near shore, and the first measurement alone cannot see it. So the pursuit is
// measured twice: once with the critter up the board, and once after it drops back.

import { clearIce, startCrossing, ROW_MEDIAN, ROW_NEAR } from "../_helpers.mjs";

const manhattan = (b, c) => Math.abs(b.col - c.col) + Math.abs(b.row - c.row);

// Where the critter waits for each measurement, and where the bear starts: far enough
// that closing the gap is unmistakable, near enough that a second of pursuit shows it.
const CRITTER_COL = 20;
const BEAR_COL = 5;

// The second measurement runs longer, because the bear has further to come once the
// critter drops nine rows to the shore.
const CLOSE_TICKS = 120; // 1 s
const RETREAT_TICKS = 180; // 1.5 s

export default function item() {
  // The distance either side of each measurement, and the state at the end of each.
  let d0;
  let d1;
  let s1;
  let d2;
  let d3;
  let s3;

  return {
    id: "hunter.pursues",

    // Pose the pursuit: the critter fixed on the solid median and a bear fifteen
    // columns away.
    //
    // The road is cleared. The item is about the pursuit closing, and a bear reset by
    // traffic partway through (specs/hunter.md) would take the measurement's subject off
    // the board — a hazard doing its job, read as a pursuit that failed.
    async arrange(api) {
      await startCrossing(api);
      await clearIce(api);
      await api.call("placeCritter", CRITTER_COL, ROW_MEDIAN); // median, solid
      await api.call("setBear", 0, { col: BEAR_COL, row: ROW_MEDIAN });
      const s0 = await api.snapshot();
      d0 = manhattan(s0.bears[0], s0.critter);
    },

    // A second of the real pursuit brain closing in, then the critter drops back to the
    // near shore and the pursuit has to follow it down. Both are measured, and both are
    // the clip.
    async act(api) {
      await api.advance(CLOSE_TICKS);
      s1 = await api.snapshot();
      d1 = manhattan(s1.bears[0], s1.critter);

      // Drop the critter back to the near shore. A control op, not a reset — the
      // crossing carries on and the bear that is already out stays out.
      await api.call("placeCritter", CRITTER_COL, ROW_NEAR);
      const s2 = await api.snapshot();
      d2 = manhattan(s2.bears[0], s2.critter);
      await api.advance(RETREAT_TICKS);
      s3 = await api.snapshot();
      d3 = manhattan(s3.bears[0], s3.critter);
    },

    async assert(api, check) {
      check.expectLt(
        "the bear closes on the critter (distance shrinks)",
        d1,
        d0,
      );
      check.expectNe("the critter is not yet caught", s1.phase, "dying");

      // The bear has to still be out for the second reading to mean anything: a build
      // that took it off the board would otherwise report a distance to nothing.
      check.expectEq(
        "the bear is still on the strait after the critter drops back",
        s3.bears[0].present,
        true,
      );
      check.expectLt(
        "the hunt follows the critter back down the board, rather than switching off",
        d3,
        d2,
      );
    },
  };
}
