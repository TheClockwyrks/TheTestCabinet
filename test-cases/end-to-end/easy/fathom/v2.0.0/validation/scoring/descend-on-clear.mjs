// scoring.descend-on-clear: clearing every plankton descends to a deeper maze.
//
// Posing the last plankton is instant (`arrange`); eating it and then letting the cleared
// interstitial run out into the next maze is the real sim, so it is `act` — and that
// descent is what the clip shows.
//
// Which neighbor `poseLastPlankton` chose is the build's own call and is not reported by
// `snapshot`, so `actEatLastPlankton` tries each open neighbor rather than assuming one
// (see its note in ../_helpers.mjs).
import { startPlaying, actEatLastPlankton } from "../_helpers.mjs";

export default function item() {
  let depthBefore;
  let clearedScreen;
  let after;

  return {
    id: "scoring.descend-on-clear",

    async arrange(api) {
      const snap = await startPlaying(api);
      depthBefore = snap.depth;
      await api.call("poseLastPlankton");
    },

    async act(api) {
      const r = await actEatLastPlankton(api);
      clearedScreen = r.snap.screen;
      await api.advance(240); // 240 ticks = the old 2.0 s: past the cleared interstitial → descend
      after = await api.snapshot();
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("the maze is cleared", clearedScreen, "cleared");
      check.expectEq(
        "clearing descends to a deeper maze",
        after.depth,
        depthBefore + 1,
      );
    },
  };
}
