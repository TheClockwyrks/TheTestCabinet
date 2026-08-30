// Automated validation for worm.drop-passes-through: a drop is never blocked. The
// head enters the tile one row down in its own column even when a node already stands
// there, and leaves that node exactly as it was.
//
// specs/worm.md blocks a HORIZONTAL step on a node, a segment, or the side edge, and
// blocks a drop on nothing at all. The two are easy to conflate — a build that treats
// "the tile ahead is occupied" as one rule for both axes turns the worm a second time
// on the way down, or stalls it in its row — and the difference is invisible on an
// empty board, which is where every other winding item poses its worm. So this one
// poses a node in the landing tile and reads back where the head went and what it did
// to what was standing there.
//
// The landing node is posed CHARGED (`C = 2`), not inert. An inert node cannot show
// the difference between "left alone" and "replaced by a fresh inert node", and a
// build that charges what it drops onto would read as `1` where a bump reads `1` too.
// At 2 every wrong answer is a distinct number: a charge on contact reads 3, a fresh
// node reads 0, an eaten node reads -1 (absent).

import {
  actWormStep,
  actWormToColumn,
  chargeAt,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

// The blocking node sits far enough along the row that the worm has six tiles of empty
// board to wind across first — the run-up the clip opens on (see `actWormToColumn`).
// Nothing is on those tiles, so it cannot touch the verdict.
const BLOCK_C = 16;
const R = 5;
const START_C = BLOCK_C - 7;

// Where the head is standing when it is blocked, and so the column it drops down.
const TURN_C = BLOCK_C - 1;
const LANDING_CHARGE = 2;

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.drop-passes-through",

    async arrange(api) {
      await freshBoard(api);
      // The node that blocks the horizontal step and turns the worm.
      await api.call("setNode", BLOCK_C, R, 0);
      // And the one standing in the tile the turn drops it into.
      await api.call("setNode", TURN_C, R + 1, LANDING_CHARGE);
      await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1); // heading at the node
    },

    // The run-up and the tile-step into the node are the clip: the reviewer watches
    // the worm wind in, then drop straight through the node below it.
    async act(api) {
      await actWormToColumn(api, TURN_C); // ~0.84s of visible approach
      before = (await api.snapshot()).worms[0];
      snap = await actWormStep(api);
      // Every operand is captured; the sim runs on only so the clip shows the worm
      // heading back the other way rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the worm starts heading right", before.dh, 1);
      check.expectEq("the worm starts heading down", before.dv, 1);

      // The drop happened, into the occupied tile, in the head's own column.
      check.expectEq(
        "the worm drops one row into the occupied tile",
        head(snap).r,
        R + 1,
      );
      check.expectEq(
        "the drop stays in the head's own column",
        head(snap).c,
        TURN_C,
      );
      check.expectEq("the worm reverses its heading", snap.worms[0].dh, -1);
      // A build that treats the occupied landing tile as a block has to do something
      // else with the worm's vertical direction; the specified drop leaves it alone.
      check.expectEq(
        "the worm keeps descending (the drop did not flip it)",
        snap.worms[0].dv,
        1,
      );

      // And the node it dropped onto is untouched: not charged by the contact, not
      // destroyed, not replaced by a fresh inert node.
      check.expectEq(
        "the node in the landing tile keeps the charge it had",
        chargeAt(snap, TURN_C, R + 1),
        LANDING_CHARGE,
      );
      // The node that actually blocked the step is charged, exactly as it would be on
      // an empty board — the pass-through changes nothing about the collision that
      // turned the worm.
      check.expectEq(
        "the blocking node is charged",
        chargeAt(snap, BLOCK_C, R),
        1,
      );
    },
  };
}
