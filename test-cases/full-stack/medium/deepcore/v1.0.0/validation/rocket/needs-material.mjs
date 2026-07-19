// Automated validation for rocket.needs-material.
//
// The Guidance Unit cannot be fabricated without Resonite (nor the Thruster without Cryenite);
// supplying the material lets it install — so the shallows alone cannot win. We fund the miner, build
// the two Credits-only parts, then confirm the material gate on Guidance and Thruster.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocket.needs-material");

  await newRun(api);
  await api.call("grantCredits", 22000);
  await api.call("fabricate"); // hull-frame
  await api.call("fabricate"); // fuel-cells
  check.expectEq("next up is the material-gated Guidance", (await api.snapshot()).rocket.nextComponent, "guidance");

  await api.call("fabricate"); // no Resonite → must be refused
  check.expectEq("Guidance is blocked without Resonite", (await api.snapshot()).rocket.nextComponent, "guidance");

  await api.call("giveMaterial", "resonite");
  await api.call("fabricate");
  const afterG = await api.snapshot();
  check.expectOk("Guidance installs once Resonite is supplied", afterG.rocket.installed.includes("guidance"));
  check.expectEq("next up is the Thruster", afterG.rocket.nextComponent, "thruster");

  await api.call("fabricate"); // no Cryenite → refused
  check.expectEq("the Thruster is blocked without Cryenite", (await api.snapshot()).rocket.nextComponent, "thruster");
  await api.call("giveMaterial", "cryenite");
  await api.call("fabricate");
  check.expectOk("the Thruster installs once Cryenite is supplied", (await api.snapshot()).rocket.installed.includes("thruster"));

  await liveClip(api, 500);
  return check.verdict();
}
