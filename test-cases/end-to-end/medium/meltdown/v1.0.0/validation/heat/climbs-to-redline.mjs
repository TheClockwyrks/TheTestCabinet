// Automated validation for the Heat sub-item `climbs-to-redline`.
//
// An emitter's heat damage multiplier climbs on an accelerating curve to 3.5x at
// its per-tower redline (specs/heat.md). Heat is posed across the range as a
// precondition and the real damage curve's multiplier is read back at each step; it
// must rise monotonically and reach ~3.5 at the redline. The Arc's redline is 80.

import { newGame, build, tower, combatSetup, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heat.climbs-to-redline");

  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 6, 20);

  const heats = [0, 20, 40, 60, 80];
  const mults = [];
  for (const h of heats) {
    await api.call("setHeat", id, h);
    mults.push((await tower(api, id)).heatMult);
  }

  check.expectClose("cold multiplier (~0.35x)", mults[0], 0.35, 0.02);
  check.expectClose("multiplier at the redline (~3.5x)", mults[4], 3.5, 0.02);
  for (let i = 1; i < mults.length; i += 1) {
    check.expectGt(`heat ${heats[i]} multiplies harder than heat ${heats[i - 1]}`, mults[i], mults[i - 1]);
  }

  // A clip: the same emitter heating from feeble toward full power as it fires.
  await newGame(api, "containment", "medium", 100000);
  await combatSetup(api, "arc", 6, 20);
  await liveClip(api, 1800);
  return check.verdict();
}
