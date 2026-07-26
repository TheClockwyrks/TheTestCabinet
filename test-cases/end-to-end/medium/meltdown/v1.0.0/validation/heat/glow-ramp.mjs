// Automated validation for the Heat sub-item `glow-ramp`.
//
// A tower's glow tracks its heat from cold blue up to white-hot (specs/heat.md).
// The check samples the pixels the build actually RENDERS on a Lance's body cold and
// hot — the fill must shift from blue-dominant to warm/white with a much higher red
// channel. Reading the rendered pixel means a build cannot pass by claiming a color
// it does not draw.

import { newGame, build, actSampleTowerBody } from "../_helpers.mjs";

export default function item() {
  let towerId;
  let cold;
  let hot;

  return {
    id: "heat.glow-ramp",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "lance", 6, 8);
    },

    // Pose cold, sample the painted body, pose hot, sample again. Each sample settles
    // for a frame first — these read what the build DREW, and an instant advance
    // paints nothing, so without the settle the read would race the renderer. The
    // ramp between the two is also what the clip shows.
    async act(api) {
      await api.call("setHeat", towerId, 0);
      cold = await actSampleTowerBody(api, towerId);

      await api.call("setHeat", towerId, 95);
      hot = await actSampleTowerBody(api, towerId);

      await api.screenshot("glow");
    },

    async assert(api, check) {
      check.expectGt(
        "a cold tower reads blue (blue channel above red)",
        cold.b,
        cold.r + 15,
      );
      check.expectGt(
        "a hot tower reads warm/white (red channel far above cold)",
        hot.r,
        cold.r + 60,
      );
      check.expectGt(
        "a hot tower's red channel dominates its blue",
        hot.r,
        hot.b + 30,
      );
    },
  };
}
