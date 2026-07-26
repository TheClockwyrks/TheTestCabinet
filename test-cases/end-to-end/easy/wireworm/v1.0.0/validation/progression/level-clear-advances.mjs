// Automated validation for progression.level-clear-advances: clearing every worm
// segment advances the run to the next level.
//
// A short worm on the level's active run is the precondition; clearing it with a real
// shot triggers the real levelClear, and the level increments while the game keeps
// playing — read back from the snapshot.

import {
  TICK,
  actFireAndResolve,
  freshBoard,
  setWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let startLevel;
  let snap;

  return {
    id: "progression.level-clear-advances",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, [{ c: 20, r: 15 }], 1, 1); // a single-segment worm on the active run
      await api.call("setCursor", tileCX(20), 688);
    },

    // The shot that clears the worm and the advance it triggers are one scenario,
    // and this is the clip: the reviewer watches the level roll over.
    async act(api) {
      startLevel = (await api.snapshot()).level;
      await actFireAndResolve(api);
      // The advance is a CONSEQUENCE of the shot, not part of resolving it: the worm
      // is cleared when the bolt lands, but the level rolls over on a later tick,
      // once the emptied worm has been reaped. Reading the snapshot `actFireAndResolve`
      // hands back would sample the frame before that, so wait for the advance itself.
      const r = await api.until((s) => s.level !== startLevel, {
        max: 120, // 1s — far longer than the roll-over needs
        poll: TICK,
      });
      snap = r.snap;
      // Every operand is captured; the sim runs on only so the new level's banner is
      // legible at the end of the clip.
      await api.advance(120); // 1s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("the run starts on level 1", startLevel, 1);
      check.expectEq("clearing the worm advances the level", snap.level, 2);
      check.expectEq("the game keeps playing", snap.screen, "playing");
    },
  };
}
