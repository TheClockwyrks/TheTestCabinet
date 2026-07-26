// Automated validation for foes.corruptor-crawls: the corruptor crawls horizontally
// across an upper row, holding its row (it does not descend).
//
// A corruptor posed on an upper row is the precondition; its motion is produced by
// the real updateFoe corruptor branch. Its horizontal position advances while its
// vertical position holds at the row.

import { freshBoard, tileCY } from "../_helpers.mjs";

const ROW = 3;

export default function item() {
  let before;
  let after;

  return {
    id: "foes.corruptor-crawls",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "corruptor", { row: ROW, x: 100, vx: 130 });
    },

    // The crawl IS the clip: the reviewer watches the corruptor track across the row
    // it is asserted to hold.
    async act(api) {
      before = (await api.snapshot()).foes[0];
      await api.advance(180); // 180 ticks = the old 1.5s of crawling
      after = (await api.snapshot()).foes[0];
      // Both operands are captured; the sim runs on only so the clip shows a longer,
      // more readable stretch of the crawl.
      await api.advance(120); // 1s more of visible crawling
    },

    async assert(api, check) {
      check.expectGt(
        "the corruptor crawls horizontally",
        after.x,
        before.x + 100,
      );
      check.expectClose(
        "it holds its row (does not descend)",
        after.y,
        tileCY(ROW),
        1,
      );
    },
  };
}
