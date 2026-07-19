// Automated validation for rocket.credits-only.
//
// The Hull Frame and Fuel Cells are fabricated with Credits alone (no material) and each installs
// onto the rocket. We fund the miner and fabricate the first two components through the real path.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocket.credits-only");

  await newRun(api);
  await api.call("grantCredits", 5000);
  const before = await api.snapshot();
  check.expectEq("the next component is the Hull Frame", before.rocket.nextComponent, "hull-frame");

  await api.call("fabricate");
  const a = await api.snapshot();
  check.expectOk("the Hull Frame installs with Credits alone", a.rocket.installed.includes("hull-frame"));
  check.expectEq("its Credits are deducted", before.credits - a.credits, 800);

  await api.call("fabricate");
  const b = await api.snapshot();
  check.expectOk("the Fuel Cells install with Credits alone", b.rocket.installed.includes("fuel-cells"));
  check.expectEq("their Credits are deducted", a.credits - b.credits, 1500);

  await liveClip(api, 500);
  return check.verdict();
}
