// Automated validation for cursor.costs-life-worm: a worm segment reaching the
// cursor costs a life.
//
// A worm winding along the bottom row toward the cursor, with lives to spare, is the
// precondition; the life loss is produced by the real checkCursorHit when the worm's
// own winding carries a segment onto the cursor (the cursor is not invulnerable
// here), read back as a decremented life count.
//
// The worm REACHES the cursor rather than being posed on top of it. The old
// arrangement put a segment straight onto the cursor's tile, so the touch was over
// within 50 ms of `act` starting and the clip — which cannot begin filming the
// instant the pass does — opened on the respawn that followed it, showing the
// consequence of a hit a reviewer never got to see. Winding in costs nothing in
// rigor: on a cleared field nothing stands in the worm's row to turn it, so it
// advances one tile per step at level 1's 0.14 s cadence, and the hit is still
// produced by the real collision code rather than by the pose.

import { freshBoard, setWorm, straightWorm } from "../_helpers.mjs";

// The worm's approach along the bottom row. The cursor sits at tile (20, 19) and
// both the head and the tile one short of it overlap it, so a head starting at
// column 6 and heading right closes the gap in thirteen steps — about 1.8 s at level
// 1 — which is the approach the clip shows. Six segments make it read as a worm
// rather than a lone block without reaching back past the left edge.
const APPROACH_HEAD_C = 6;
const APPROACH_ROW = 19;
const APPROACH_LEN = 6;
const approach = () =>
  straightWorm(APPROACH_HEAD_C, APPROACH_ROW, APPROACH_LEN, 1);

export default function item() {
  let before;
  let after;

  return {
    id: "cursor.costs-life-worm",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 3);
      await api.call("setCursor", 640, 688); // tile (20,19)
      await setWorm(api, approach(), 1, 1); // clear of the cursor, heading at it
    },

    async act(api) {
      // `enterPlay` grants no spawn-in invulnerability (specs/instrumentation.md), so
      // this normally passes straight through. It is here so the check still measures
      // the hit on a build that reaches this state carrying some. The worm is re-posed
      // UNCONDITIONALLY afterwards — a worm left winding for the length of an
      // invulnerability would already have crossed the cursor's tile while it was
      // shielded, and branching on whether any time was actually spent would let the
      // two passes diverge.
      await api.until((s) => !s.cursor.invulnerable, { max: 600, poll: 6 });
      await setWorm(api, approach(), 1, 1);
      before = (await api.snapshot()).lives;
      // The worm winds in under its own cadence and the real collision code decides
      // when it has arrived; polling for the life count is what makes the wait as
      // long as the approach actually takes, on a build of any worm speed. The cap is
      // 4 s, comfortably past the ~1.8 s the thirteen steps need.
      const hit = await api.until((s) => s.lives < before, {
        max: 480,
        poll: 6,
      });
      after = hit.snap.lives;
      // Both operands are captured; the sim runs on only so the clip shows the
      // respawn rather than ending on a single frame.
      await api.advance(90); // 0.75s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("three lives before the hit", before, 3);
      check.expectEq(
        "a worm segment reaching the cursor costs a life",
        after,
        2,
      );
    },
  };
}
