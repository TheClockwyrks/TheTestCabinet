// Automated validation for the Heat sub-item `glow-ramp`.
//
// A tower's glow tracks its heat from cold blue up to white-hot (specs/heat.md).
// The check samples the pixels the build actually RENDERS on a Lance's footprint cold
// and hot — the color it paints must shift from blue-dominant to warm/white with a
// much higher red channel. Reading the rendered pixel means a build cannot pass by
// claiming a color it does not draw. Where in the footprint the glow lives is the
// build's own presentation choice, so the two samples are paired through
// `glowBetween`, which finds the glow in whatever moved between them rather than
// assuming a solid fill.

import { newGame, build, actSampleTower, glowBetween } from "../_helpers.mjs";

export default function item() {
  let towerId;
  let glow;

  return {
    id: "heat.glow-ramp",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "lance", 6, 8);
    },

    // Pose cold, sample the painted footprint, pose hot, sample again. Each sample
    // settles for a frame first — these read what the build DREW, and an instant
    // advance paints nothing, so without the settle the read would race the renderer.
    // The ramp between the two is also what the clip shows.
    async act(api) {
      await api.call("setHeat", towerId, 0);
      const cold = await actSampleTower(api, towerId);

      await api.call("setHeat", towerId, 95);
      const hot = await actSampleTower(api, towerId);

      glow = glowBetween(cold, hot);
      await api.screenshot("glow");
    },

    async assert(api, check) {
      // Hard: a null glow means the footprint painted identically cold and hot —
      // there is no ramp to read, and the channel assertions below would read off
      // null.
      check.assertOk("the tower repaints as its heat changes", glow !== null);
      check.expectGt(
        "a cold tower reads blue (blue channel above red)",
        glow.before.b,
        glow.before.r + 15,
      );
      check.expectGt(
        "a hot tower reads warm/white (red channel far above cold)",
        glow.after.r,
        glow.before.r + 60,
      );
      check.expectGt(
        "a hot tower's red channel dominates its blue",
        glow.after.r,
        glow.after.b + 30,
      );
    },
  };
}
