// Automated validation for progression.field-persists: the node field carries over
// into the next level rather than resetting.
//
// A few known nodes and a short worm are posed; clearing the worm advances the level
// through the real levelClear (which does NOT clear the field). The pre-placed nodes
// are still present, at their charges, on the next level.

import {
  TICK,
  actFireAndResolve,
  chargeAt,
  freshBoard,
  setWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let snap;
  let startLevel;

  return {
    id: "progression.field-persists",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 5, 5, 2);
      await api.call("setNode", 6, 6, 1);
      await api.call("setNode", 7, 7, 0);
      await setWorm(api, [{ c: 20, r: 15 }], 1, 1);
      await api.call("setCursor", tileCX(20), 688);
    },

    // The shot that clears the worm and the level advance it triggers are one
    // scenario, and this is the clip: the reviewer sees the three posed nodes still
    // standing after the banner.
    async act(api) {
      startLevel = (await api.snapshot()).level;
      await actFireAndResolve(api);
      // The level rolls over a tick or two AFTER the bolt lands (the emptied worm has
      // to be reaped first), so wait for the advance rather than reading the snapshot
      // `actFireAndResolve` returns — that one is from before it, and the field this
      // item is about is only interesting once the level has actually changed.
      const r = await api.until((s) => s.level !== startLevel, {
        max: 120,
        poll: TICK,
      });
      snap = r.snap;
      // The snapshot is captured; the sim runs on only so the surviving field is
      // legible on the new level at the end of the clip.
      await api.advance(120); // 1s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("the level advanced", snap.level, 2);
      check.expectEq(
        "a charged node persists across the advance (5,5)",
        chargeAt(snap, 5, 5),
        2,
      );
      check.expectEq(
        "a charged node persists across the advance (6,6)",
        chargeAt(snap, 6, 6),
        1,
      );
      check.expectEq(
        "an inert node persists across the advance (7,7)",
        chargeAt(snap, 7, 7),
        0,
      );
    },
  };
}
