// kindle.predators-by-light: predators are revealed by the line-of-sight light circle,
// not the vision circle — a predator inside the vision circle but beyond the light is
// not shown.
//
// The pair is posed instantly (`arrange`); `act` lets the pose settle in the sim and
// gives the build a frame to paint for the capture.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let dist;
  let windowRadius;
  let visionRadius;
  let lit;

  return {
    id: "kindle.predators-by-light",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const line = findSightLine(snap, 4); // 128 px: beyond the light (96), inside the circle (192)
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      const s = await api.snapshot();
      const g = pred(s, "gloamfin");
      dist = Math.hypot(g.x - s.forager.x, g.y - s.forager.y);
      windowRadius = s.windowRadius;
      visionRadius = s.visionRadius;
      lit = g.lit;
      await api.settle(120); // a REAL pause (the old wait(120)) so the still is painted
      await api.screenshot("bylight");
    },

    async assert(api, check) {
      check.expectLt(
        "the Gloamfin is inside the vision circle",
        dist,
        windowRadius,
      );
      check.expectGt("but beyond the light circle", dist, visionRadius);
      check.expectOk(
        "it is not shown (predators follow the light, not the vision circle)",
        lit === false,
      );
    },
  };
}
