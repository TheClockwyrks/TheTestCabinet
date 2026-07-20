// Automated validation for pathing.never-seal-refused: a placement that would seal a
// waypoint segment is refused and changes nothing, while a legal placement is accepted.
//
// On the default map the Collector is tile (49,20); a 2x2 anchored at (48,19) would cover it
// and seal the final WP->Collector segment, so the real placement path refuses it (no
// candidate lands, the stamp allowance is unchanged). A legal placement elsewhere then
// lands normally, confirming the op itself works.

import { startBuild, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.never-seal-refused");

  const s0 = await startBuild(api);
  const before = s0.towers.length;
  const stamps0 = s0.stampsLeft;

  // A placement that would seal the final segment (covering the Collector tile).
  await api.call("setNextRoll", "capacitor", 1);
  await api.call("placeRock", 48, 19);
  const s1 = await snap(api);
  check.expectEq("a sealing placement lands no candidate", s1.towers.length, before);
  check.expectEq("a refused placement consumes no stamp", s1.stampsLeft, stamps0);

  // A legal placement in the open yard IS accepted.
  await api.call("setNextRoll", "capacitor", 1);
  await api.call("placeRock", 6, 10);
  const s2 = await snap(api);
  check.expectEq("a legal placement lands a candidate", s2.towers.length, before + 1);
  check.expectEq("...and spends one stamp", s2.stampsLeft, stamps0 - 1);

  await api.screenshot("refused");
  return check.verdict();
}
