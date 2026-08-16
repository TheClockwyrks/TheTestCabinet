// Automated validation for worm.shot-on-shared-tile: where a segment stands on a tile
// that also holds a node, a bolt strikes the segment, and the node under it keeps the
// charge it had.
//
// A segment and a node share a tile whenever the worm drops onto one
// (worm.drop-passes-through) or dives through the field, so a column can hold two
// things at the same height and specs/controls.md's "the first node, worm segment, or
// foe in its column" has to be read against both. specs/worm.md answers both halves:
// the bolt takes the segment, and the fresh inert node a shot-killed segment leaves is
// not laid where a node already stands.
//
// The node is posed at `C = 2`, which makes every outcome a different number. Correct
// is 2 (untouched). A bolt that struck the node instead reads 1 (de-energized one
// level, specs/charge.md) with the worm still whole. A build that lays its fresh node
// over the existing one reads 0, and one that clears the tile reads -1.

import {
  actFireAndResolve,
  actWormToColumn,
  chargeAt,
  freshBoard,
  segmentAt,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

// Row 17 keeps the bolt's flight (about 0.04 s from the muzzle) well inside the 0.14 s
// between worm tile steps, so the tail is still over the node when the bolt arrives.
const R = 17;
// The shared tile: the node's column, and the tile the worm's tail walks onto.
const SHARED_C = 12;
const LENGTH = 6;
// The worm is posed with its head one tile PAST the node and its tail four tiles short
// of it, then walked in. The head therefore moves away from the node and never steps
// onto it — a node in the head's path would block the step and turn the worm
// (specs/worm.md), which is a different scenario entirely. The body simply follows the
// head's path, so the tail arrives over the node after four tile steps, about 0.56 s of
// visible winding before the shot.
const START_C = SHARED_C + 1;
// The tail trails the head by `LENGTH - 1` tiles, so this is the head's column at the
// instant the tail stands on the shared tile.
const FIRE_AT_C = SHARED_C + (LENGTH - 1);
const NODE_CHARGE = 2;

export default function item() {
  let posed;
  let before;
  let snap;

  return {
    id: "worm.shot-on-shared-tile",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", SHARED_C, R, NODE_CHARGE);
      await setWorm(api, straightWorm(START_C, R, LENGTH, 1), 1, 1);
      await api.call("setCursor", tileCX(SHARED_C), 688);
    },

    // The wind-in, the shot and its aftermath are the clip: the reviewer watches the
    // worm's tail draw over the charged node and the bolt take the segment off it.
    async act(api) {
      await actWormToColumn(api, FIRE_AT_C); // ~0.56s of visible approach
      const at = await api.snapshot();
      posed = {
        segment: segmentAt(at, SHARED_C, R),
        charge: chargeAt(at, SHARED_C, R),
        length: at.worms[0]?.segments.length ?? 0,
      };
      snap = await actFireAndResolve(api);
      // Every operand is captured; the sim runs on only so the outcome is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      // The scenario only means anything if the segment really did come to rest over
      // the node, so that is asserted rather than assumed: a build whose body does not
      // follow the head's path lands its tail somewhere else, and the shot below would
      // then be measuring an ordinary segment on an ordinary tile.
      check.expectOk(
        "a segment stands on the node's tile when the shot is taken",
        posed.segment,
      );
      check.expectEq(
        "the node under it is charged before the shot",
        posed.charge,
        NODE_CHARGE,
      );

      // The bolt took the segment, not the node.
      check.expectEq(
        "the bolt shortens the worm by the segment it struck",
        snap.worms[0]?.segments.length ?? 0,
        posed.length - 1,
      );
      check.expectEq(
        "the node under the killed segment keeps the charge it had",
        chargeAt(snap, SHARED_C, R),
        NODE_CHARGE,
      );
    },
  };
}
