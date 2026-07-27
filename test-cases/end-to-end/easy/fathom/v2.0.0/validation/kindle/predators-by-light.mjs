// kindle.predators-by-light: predators are revealed by the line-of-sight light circle,
// not the vision circle — a predator inside the vision circle but beyond the light is
// not shown.
//
// The pair is posed instantly (`arrange`); `act` lets the pose settle in the sim and
// gives the build a frame to paint for the capture.
import {
  DIRS,
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let line;
  let dist;
  let windowRadius;
  let visionRadius;
  let lit;
  let nearDist;
  let nearVisionRadius;
  let nearLit;

  return {
    id: "kindle.predators-by-light",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      line = findSightLine(snap, 4); // 128 px: beyond the light (96), inside the circle (192)
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

      // The positive half of the same rule. On its own "it is not shown" is satisfied
      // by a build that never shows a predator at all — including one whose snapshot
      // simply always reports `lit: false` — so the point could be earned for the wrong
      // reason. Slide the same Gloamfin to two tiles from the forager, well
      // inside the light circle and still in line of sight, and confirm the light does
      // light it. Together the two readings say what the point claims: the LIGHT decides,
      // not the vision circle.
      const [dc, dr] = DIRS[line.dir];
      await api.call("setPredator", "gloamfin", {
        tx: line.forager.tx + dc * 2,
        ty: line.forager.ty + dr * 2,
        mode: "wander",
      });
      await api.advance(6);
      const sn = await api.snapshot();
      const gn = pred(sn, "gloamfin");
      nearDist = Math.hypot(gn.x - sn.forager.x, gn.y - sn.forager.y);
      nearVisionRadius = sn.visionRadius;
      nearLit = gn.lit;
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
      check.expectLt(
        "moved inside the light circle it is within the light",
        nearDist,
        nearVisionRadius,
      );
      check.expectOk(
        "and there it IS shown — the light is what reveals a predator",
        nearLit === true,
      );
    },
  };
}
