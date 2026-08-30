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
    //
    // A fabrication is one instant control op, so back-to-back calls move the Credits readout and
    // the rocket pips twice between three consecutive frames: the clip lands on a final balance and
    // two lit pips, with no deduction ever visible. What this item asserts is the two DEDUCTIONS
    // (`4000`, then `7500`), so each one needs a beat before it to establish the balance it comes
    // out of and a beat after to show what it left.
    async act(api) {
      await api.advance(45); // 45 ticks = 0.75 s on the funded balance and the empty rocket
      await api.call("fabricate");
      a = await api.snapshot();
      await api.advance(60); // 60 ticks = 1 s: the Hull Frame's pip lit, its price gone

      await api.call("fabricate");
      b = await api.snapshot();
      await api.advance(90); // 90 ticks = 1.5 s: the Fuel Cells' pip lit, the balance down again
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
