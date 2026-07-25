// Automated validation for cursor.costs-life-worm: a worm segment reaching the
// cursor costs a life.
//
// A worm segment posed on the cursor's tile with lives to spare is the precondition;
// the life loss is produced by the real checkCursorHit when the sim steps (the
// cursor is not invulnerable here), read back as a decremented life count.

import { freshBoard, setWorm } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "cursor.costs-life-worm",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 3);
      await api.call("setCursor", 640, 688); // tile (20,19)
      await setWorm(api, [{ c: 20, r: 19 }], 1, 1); // a segment on the cursor's tile
    },

    async act(api) {
      // `enterPlay` grants no spawn-in invulnerability (specs/instrumentation.md), so
      // this normally passes straight through. It is here so the check still measures
      // the hit on a build that reaches this state carrying some, which
      // specs/progression.md explicitly encourages. The segment is re-posed
      // UNCONDITIONALLY afterwards — a worm left winding for the length of an
      // invulnerability would have stepped off the cursor's tile, and branching on
      // whether any time was actually spent would let the two passes diverge.
      await api.until((s) => !s.cursor.invulnerable, { max: 600, poll: 6 });
      await setWorm(api, [{ c: 20, r: 19 }], 1, 1);
      before = (await api.snapshot()).lives;
      await api.advance(6); // 6 ticks = the old 0.05s — one sim beat, enough for the touch
      after = (await api.snapshot()).lives;
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
