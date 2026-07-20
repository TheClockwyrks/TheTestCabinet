// Automated validation for rocket.credits-only.
//
// The Hull Frame and Fuel Cells are fabricated with Credits alone (no material) and each installs
// onto the rocket. We fund the miner and fabricate the first two components through the real path.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let before;
  let a;
  let b;

  return {
    id: "rocket.credits-only",

    // A funded miner with an empty rocket, so the Hull Frame is next up.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 15000);
      before = await api.snapshot();
    },

    // The two fabrications ARE the behavior under test, so they happen here and the clip shows both
    // parts install.
    async act(api) {
      await api.call("fabricate");
      a = await api.snapshot();

      await api.call("fabricate");
      b = await api.snapshot();

      await api.advance(30); // 30 ticks = 0.5 s, the old 500 ms clip tail
    },

    async assert(api, check) {
      check.expectEq(
        "the next component is the Hull Frame",
        before.rocket.nextComponent,
        "hull-frame",
      );
      check.expectOk(
        "the Hull Frame installs with Credits alone",
        a.rocket.installed.includes("hull-frame"),
      );
      check.expectEq(
        "its Credits are deducted",
        before.credits - a.credits,
        4000,
      );
      check.expectOk(
        "the Fuel Cells install with Credits alone",
        b.rocket.installed.includes("fuel-cells"),
      );
      check.expectEq("their Credits are deducted", a.credits - b.credits, 7500);
    },
  };
}
