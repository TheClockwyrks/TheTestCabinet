// Automated validation for pathing.map-c-housings: on The Transformer Yard the two housing
// rectangles are pre-blocked and never buildable, while the base waypoint route is open.
//
// The first housing spans tiles (12,6)..(19,12); a placement anchored inside it is refused
// (nothing lands), and the base ground route through the chain is finite and open.

import { startBuild, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.map-c-housings");

  const s0 = await startBuild(api, { map: "transformer" });
  check.expectEq("the run is on The Transformer Yard", s0.map, "transformer");
  check.expectGt("the base waypoint route is open (a finite maze length)", s0.mazeLength, 0);

  const before = s0.towers.length;
  await api.call("setNextRoll", "capacitor", 1);
  await api.call("placeRock", 14, 8); // inside the first fixed housing
  const s1 = await snap(api);
  check.expectEq("a placement on a fixed housing lands no candidate", s1.towers.length, before);
  check.expectEq("...and consumes no stamp", s1.stampsLeft, s0.stampsLeft);

  await api.screenshot("housings");
  return check.verdict();
}
