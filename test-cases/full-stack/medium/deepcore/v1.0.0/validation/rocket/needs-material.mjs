// Automated validation for rocket.needs-material.
//
// The Guidance Unit cannot be fabricated without Resonite (nor the Thruster without Cryenite);
// supplying the material lets it install — so the shallows alone cannot win. We fund the miner, build
// the two Credits-only parts, then confirm the material gate on Guidance and Thruster.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let nextAfterCredits;
  let blockedG;
  let afterG;
  let blockedT;
  let afterT;

  return {
    id: "rocket.needs-material",

    // A funded miner with the two Credits-only parts already built, so the material gate is next.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 22000);
      await api.call("fabricate"); // hull-frame
      await api.call("fabricate"); // fuel-cells
      nextAfterCredits = (await api.snapshot()).rocket.nextComponent;
    },

    // The refusals and the installs that follow once the material is supplied are the behavior, so
    // the whole gate sequence runs here and the clip shows it.
    async act(api) {
      await api.call("fabricate"); // no Resonite → must be refused
      blockedG = (await api.snapshot()).rocket.nextComponent;

      await api.call("giveMaterial", "resonite");
      await api.call("fabricate");
      afterG = await api.snapshot();

      await api.call("fabricate"); // no Cryenite → refused
      blockedT = (await api.snapshot()).rocket.nextComponent;
      await api.call("giveMaterial", "cryenite");
      await api.call("fabricate");
      afterT = await api.snapshot();

      await api.advance(30); // 30 ticks = 0.5 s, the old 500 ms clip tail
    },

    async assert(api, check) {
      check.expectEq(
        "next up is the material-gated Guidance",
        nextAfterCredits,
        "guidance",
      );
      check.expectEq(
        "Guidance is blocked without Resonite",
        blockedG,
        "guidance",
      );
      check.expectOk(
        "Guidance installs once Resonite is supplied",
        afterG.rocket.installed.includes("guidance"),
      );
      check.expectEq(
        "next up is the Thruster",
        afterG.rocket.nextComponent,
        "thruster",
      );
      check.expectEq(
        "the Thruster is blocked without Cryenite",
        blockedT,
        "thruster",
      );
      check.expectOk(
        "the Thruster installs once Cryenite is supplied",
        afterT.rocket.installed.includes("thruster"),
      );
    },
  };
}
