// Automated validation for audio.level-clear: a distinct cue plays when a level is
// cleared.
//
// A single-segment worm on level 1 is the precondition (clearing it advances to
// level 2, well short of the Victory sting at level 12, so this cue is isolated
// from that one); the cue is confirmed by the Web Audio source log growing across
// the real levelClear the shot triggers.

import {
  TICK,
  actFireAndResolve,
  armAudio,
  audioCount,
  freshBoard,
  setWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let startLevel;
  let before;
  let snap;
  let after;

  return {
    id: "audio.level-clear",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, [{ c: 20, r: 15 }], 1, 1); // a single-segment worm on the active run
      await api.call("setCursor", tileCX(20), 688);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The shot that clears the worm and the advance it triggers are one scenario,
    // and this is the clip and the one event this item drives.
    async act(api) {
      startLevel = (await api.snapshot()).level;
      before = await audioCount(api);
      await actFireAndResolve(api);
      // The advance is a CONSEQUENCE of the shot, not part of resolving it: the
      // worm is cleared when the bolt lands, but the level rolls over on a later
      // tick, once the emptied worm has been reaped.
      const r = await api.until((s) => s.level !== startLevel, {
        max: 120, // 1s — far longer than the roll-over needs
        poll: TICK,
      });
      snap = r.snap;
      after = await audioCount(api);
      // Every operand is captured; the sim runs on only so the new level's banner
      // is legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("the run starts on level 1", startLevel, 1);
      check.expectEq("clearing the worm advances the level", snap.level, 2);
      check.expectGt(
        "a cue plays on clearing a level (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
