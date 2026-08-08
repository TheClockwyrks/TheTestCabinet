// Automated validation for charge.discharge-fries-clean: worm segments within 2
// tiles of a detonated node are destroyed by the discharge and leave NO node.
//
// A critical node with a worm laid alongside it are the preconditions; the fry is
// produced by the real detonate -> fryWorms path when the shot lands. The worm sits
// on a low row so the bolt resolves before the worm steps, catching it in place. The
// near segments are gone AND leave no node (unlike a bolt-killed segment); segments
// beyond the blast survive.

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

// The scenario sits on row 17, one row above the player band. The bolt has only a
// tile and a half to travel from the muzzle (about 0.04 s), which is what keeps the
// blast comfortably inside the 0.14 s window between worm tile steps — so the worm
// is still laid out as the assertions count it when the detonation lands.
const R = 17;
const NODE_C = 10;
// The worm walks LEFT into position rather than starting there, so the clip opens
// on a run-up instead of on the blast. It is posed to the right of the node — with
// its head at column 18 the eight segments cover 11..18, and walking in from
// column 18 leftwards is the only approach that never lays a segment on the
// critical node's own tile on the way.
const HEAD_START_C = 18;
const FIRE_AT_C = 11;

export default function item() {
  let snap;

  return {
    id: "charge.discharge-fries-clean",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", NODE_C, R, 3); // critical node, shot from below
      // Eight segments trailing off to the right, heading left at the node.
      await setWorm(api, straightWorm(HEAD_START_C, R, 8, -1), -1, 1);
      await api.call("setCursor", tileCX(NODE_C), 688);
    },

    // The approach, the shot, the detonation and the fry are one scenario. This is
    // the clip: the reviewer watches the worm wind into the critical node's reach
    // and then the very blast whose casualties the assertions count.
    async act(api) {
      // Walk the head to column 11, which lays the worm across 11..18: columns 11
      // and 12 within the blast's 2-tile reach, 13+ beyond it.
      await actWormToColumn(api, FIRE_AT_C); // ~0.98s of visible approach
      snap = await actFireAndResolve(api);
      // The snapshot is captured; the sim runs on only so the gap the blast tore in
      // the worm is legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectOk(
        "the near segment at 11 is fried",
        !segmentAt(snap, 11, R),
      );
      check.expectOk(
        "the near segment at 12 is fried",
        !segmentAt(snap, 12, R),
      );
      check.expectEq(
        "the fried tile at 11 holds no node",
        chargeAt(snap, 11, R),
        -1,
      );
      check.expectEq(
        "the fried tile at 12 holds no node",
        chargeAt(snap, 12, R),
        -1,
      );
      check.expectGt(
        "segments beyond the blast survive as a worm",
        snap.worms.length,
        0,
      );
    },
  };
}
