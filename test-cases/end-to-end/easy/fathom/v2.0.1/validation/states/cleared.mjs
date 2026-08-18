// states.cleared: clearing a maze shows the cleared interstitial.
//
// Posing the last plankton is instant (`arrange`); swimming onto it is the real sim, so
// it is `act`, and the capture at the end is the interstitial itself.
//
// Which neighbor `poseLastPlankton` chose is the build's own call and is not reported by
// `snapshot`, so `actEatLastPlankton` tries each open neighbor rather than assuming one
// (see its note in ../_helpers.mjs).
import { startPlaying, actEatLastPlankton } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.cleared",

    async arrange(api) {
      await startPlaying(api);
      await api.call("poseLastPlankton");
    },

    async act(api) {
      const r = await actEatLastPlankton(api);
      screen = r.snap.screen;
      await api.settle(150); // a REAL pause (the old wait(150)) so the interstitial is painted
      await api.screenshot("cleared");
    },

    async assert(api, check) {
      check.expectEq(
        "clearing a maze shows the cleared screen",
        screen,
        "cleared",
      );
    },
  };
}
