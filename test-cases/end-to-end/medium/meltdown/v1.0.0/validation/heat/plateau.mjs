// Automated validation for the Heat sub-item `plateau`.
//
// From the redline up to the 100 trip the heat multiplier holds flat at 3.5x
// (specs/heat.md) — going past the redline adds trip risk, not more damage. Heat is
// posed at the redline, between it and 100, and just below 100, and the real damage
// curve's multiplier is read back — all ~3.5. The Arc's redline is 80.

import { newGame, build, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heat.plateau");

  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 6, 20);

  const points = [80, 90, 99];
  for (const h of points) {
    await api.call("setHeat", id, h);
    const m = (await tower(api, id)).heatMult;
    check.expectClose(`multiplier at heat ${h} holds at 3.5x`, m, 3.5, 0.02);
  }

  await api.call("setHeat", id, 90);
  await api.wait(80);
  await api.screenshot("plateau");
  return check.verdict();
}
