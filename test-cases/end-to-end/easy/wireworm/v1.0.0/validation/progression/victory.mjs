// Automated validation for progression.victory: clearing the worm on level 12 ends
// the run on the Victory screen.
//
// Level 12 with a short worm on an empty field is the precondition; clearing it with
// a real shot triggers the real levelClear, which at level 12 wins the game — read
// back and captured.

import { TICK, actFireAndResolve, setWorm, tileCX } from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "progression.victory",

    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("enterPlay"); // reach live play; no control op starts a run
      await api.call("setLevel", 12);
      await api.call("clearField"); // clear the scattered field so the shot reaches the worm
      // Pose the last segment low, just above the player band: the level-12 worm steps
      // fast (~0.08s/tile), so a segment placed high would wind out of the firing column
      // before the bolt climbed to it — low, the bolt reaches it within its first step.
      await setWorm(api, [{ c: 20, r: 17 }], 1, 1);
      await api.call("setCursor", tileCX(20), 688);
    },

    // The winning shot is the clip: the reviewer watches the last segment go and the
    // Victory screen come up.
    async act(api) {
      await actFireAndResolve(api);
      // Winning is a consequence of the shot, landing a tick or two after the bolt
      // does — the cleared worm has to be reaped before the level-clear check wins
      // the game. Wait for the Victory state rather than sampling the frame the bolt
      // resolved on.
      const r = await api.until((s) => s.screen !== "playing", {
        max: 120,
        poll: TICK,
      });
      snap = r.snap;
      await api.settle(300); // a real pause so the Victory screen has painted
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq("clearing level 12 wins the game", snap.screen, "victory");
    },
  };
}
