// fog.light-line-of-sight: passive light does not bend around corners — a predator
// one step around a blind corner is not lit even though it is within light range.
//
// The blind pair and the widened light are posed instantly (`arrange`); `act` lets the
// pose settle in the sim and gives the build a frame to paint for the capture.
import {
  startPlaying,
  findOccludedPair,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let g;

  return {
    id: "fog.light-line-of-sight",

    async arrange(api) {
      const snap = await startPlaying(api);
      // A Gloamfin senses nothing by light, but it HEARS within 64 px, so the occluded
      // pair is kept beyond that (minDist 70) to isolate line-of-sight as the only cause,
      // and within the widened light (maxDist 150 < V = 160 px) so the light would reach
      // it but for the wall.
      const bp = findOccludedPair(snap, { minDist: 70, maxDist: 150 });
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setForager", { tx: bp.forager.tx, ty: bp.forager.ty });
      await api.call("setPredator", "gloamfin", {
        tx: bp.pred.tx,
        ty: bp.pred.ty,
        mode: "wander",
      });
      await api.call("setBrightness", 1); // V = 160 px, well past the blind-corner gap
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      g = pred(await api.snapshot(), "gloamfin");
      await api.settle(100); // a REAL pause (the old wait(100)) so the still is painted
      await api.screenshot("los");
    },

    async assert(api, check) {
      check.expectOk(
        "a predator around a blind corner is not lit by the light",
        g.lit === false,
      );
    },
  };
}
