// Automated validation for the Heat sub-item `plateau`.
//
// From the redline up to the 100 trip the heat multiplier holds flat at 3.5x
// (specs/heat.md) — going past the redline adds trip risk, not more damage. Heat is
// posed at the redline, between it and 100, and just below 100, and the real damage
// curve's multiplier is read back — all ~3.5. The Arc's redline is 80.

import { newGame, build, tower } from "../_helpers.mjs";

const POINTS = [80, 90, 99];

export default function item() {
  let towerId;
  const mults = [];

  return {
    id: "heat.plateau",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "arc", 6, 20);
    },

    // Read the multiplier at each point of the plateau, then settle at 90 so the
    // still shows the tower drawn well past its redline.
    async act(api) {
      for (const h of POINTS) {
        await api.call("setHeat", towerId, h);
        mults.push((await tower(api, towerId)).heatMult);
      }

      await api.call("setHeat", towerId, 90);
      await api.settle(80);
      await api.screenshot("plateau");
    },

    async assert(api, check) {
      POINTS.forEach((h, i) => {
        check.expectClose(
          `multiplier at heat ${h} holds at 3.5x`,
          mults[i],
          3.5,
          0.02,
        );
      });
    },
  };
}
