// lanternjaw.dim-shakes: going dim shrinks its detection range and shakes its fix.
//
// The Lanternjaw's range is R = 128 + 192 G (specs/predators.md), so a forager that is
// within range while bright falls outside it once dim. We pose a lit forager on a long,
// straight sight line 9 tiles from the Lanternjaw — inside R at G=1 (320 px) but well
// outside it at G=0 (128 px) — let it fix, then drop brightness to 0. The real sensing
// then loses the forager and, after the Lanternjaw's ~2 s linger, drops the fix back to
// wandering. The gap is chosen so the Lanternjaw cannot close it within the linger, so
// dimming (not contact) is what ends the fix. Posing is instant (`arrange`); the fix, the
// dimming and the shaken fix are the real sim, so they are `act`.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let fixed;
  let afterDim;

  return {
    id: "lanternjaw.dim-shakes",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 9); // 288 px: inside R at G=1, outside R at G=0
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      // A single stray plankton, placed adjacent (not under) the resting forager, so
      // nothing re-brightens G while it sits still and dims.
      await api.call("poseLastPlankton");
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = 0.05 s: the real light-sense fix at full brightness
      fixed = pred(await api.snapshot(), "lanternjaw").state;
      await api.call("setBrightness", 0); // go dim — the forager falls outside the shrunk range
      await api.advance(252); // 252 ticks = 2.1 s, just past the ~2 s linger
      afterDim = pred(await api.snapshot(), "lanternjaw").state;
      await api.advance(48); // 48 ticks = 0.4 s live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the Lanternjaw is fixed on the forager while it is bright",
        fixed,
        "chase",
      );
      check.expectEq(
        "going dim shrinks its range and shakes the fix (back to wandering)",
        afterDim,
        "wander",
      );
    },
  };
}
