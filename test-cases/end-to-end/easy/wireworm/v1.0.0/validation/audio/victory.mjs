// Automated validation for audio.victory: the Victory sting plays when level 12 is
// cleared and the run is won.
//
// Level 12 with a short worm on an empty field is the precondition; clearing it
// wins the game through the real levelClear path, which at level 12 plays only the
// Victory sting (not the level-clear cue, specs/ui.md); the cue is confirmed by
// the Web Audio source log growing across that win.

import {
  TICK,
  actAudioCount,
  actFireAndResolve,
  armAudio,
  setWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;
  let after;

  return {
    id: "audio.victory",

    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("enterPlay"); // reach live play; no control op starts a run
      await api.call("setLevel", 12);
      await api.call("clearField"); // clear the scattered field so the shot reaches the worm
      // Pose the last segment low, just above the player band: the level-12 worm
      // steps fast (~0.08s/tile), so a segment placed high would wind out of the
      // firing column before the bolt climbed to it — low, the bolt reaches it
      // within its first step.
      await setWorm(api, [{ c: 20, r: 17 }], 1, 1);
      await api.call("setCursor", tileCX(20), 688);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The winning shot is the clip and the one event this item drives: the
    // reviewer watches the last segment go and the Victory screen come up.
    async act(api) {
      before = await actAudioCount(api);
      await actFireAndResolve(api);
      // Winning is a consequence of the shot, landing a tick or two after the bolt
      // does — the cleared worm has to be reaped before the level-clear check wins
      // the game.
      const r = await api.until((s) => s.screen !== "playing", {
        max: 120,
        poll: TICK,
      });
      snap = r.snap;
      after = await actAudioCount(api);
      // Every operand is captured; the sim runs on only so the Victory screen is
      // legible at the end of the clip.
      await api.advance(60); // 0.5s holding on the Victory screen
    },

    async assert(api, check) {
      check.expectEq("clearing level 12 wins the game", snap.screen, "victory");
      check.expectGt(
        "the Victory sting plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
