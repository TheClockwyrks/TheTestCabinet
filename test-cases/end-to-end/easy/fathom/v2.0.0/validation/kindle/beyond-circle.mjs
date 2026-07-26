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
  isDark,
} from "../_helpers.mjs";

export default function item() {
  let hasDrifter;
  let dist;
  let windowRadius;
  let col;

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
        "the amber drifter is clipped to black beyond the circle",
        isDark(col),
      );
    },
  };
}
