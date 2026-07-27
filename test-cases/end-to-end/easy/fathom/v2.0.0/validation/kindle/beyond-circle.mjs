// kindle.beyond-circle: the amber lights are clipped to the vision circle — a drifter
// beyond it does not show (unlike the Maze dive).
//
// The distant drifter is posed instantly (`arrange`); `act` lets the pose settle, gives
// the build a frame to paint, and reads back what was drawn where the drifter is.
import {
  startPlaying,
  denAllExcept,
  findFarTile,
  sampleColor,
} from "../_helpers.mjs";
import { isFogBlack, sampleFog } from "./_kindle.mjs";

export default function item() {
  let hasDrifter;
  let dist;
  let windowRadius;
  let col;
  let fog;

  return {
    id: "kindle.beyond-circle",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, []);
      const far = findFarTile(snap, snap.forager, 9); // beyond the vision circle
      await api.call("spawnDrifter", { tx: far.tx, ty: far.ty });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      const s = await api.snapshot();
      const d = s.drifters[0];
      hasDrifter = Boolean(d);
      dist = Math.hypot(d.x - s.forager.x, d.y - s.forager.y);
      windowRadius = s.windowRadius;
      // A REAL pause (the old wait(120)) so the scene has been painted before sampling.
      await api.settle(120);
      col = await sampleColor(api, d.x, d.y);
      // Compare against the build's own flat fog rather than an absolute darkness cut:
      // a dim-but-drawn amber glow, or ground a build with no vision circle is still
      // painting out there, both read as "dark" while plainly not being clipped.
      fog = await sampleFog(api, s, [s.forager, d]);
      await api.screenshot("clipped");
    },

    async assert(api, check) {
      check.expectOk("the distant drifter exists", hasDrifter);
      check.expectGt(
        "the drifter is beyond the vision circle",
        dist,
        windowRadius,
      );
      check.expectOk(
        "the amber drifter is clipped to the flat fog beyond the circle",
        isFogBlack(col, fog),
      );
    },
  };
}
