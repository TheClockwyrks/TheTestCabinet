// Automated validation for the Modes sub-item `bottleneck`.
//
// Bottleneck restricts building to a central zone — placements outside it are refused
// (specs/modes.md). We confirm a placement inside the central zone is valid and one
// in a corner outside it is refused.

import { newGame } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.bottleneck");

  await newGame(api, "bottleneck");
  const inside = await api.call("canPlace", "arc", 20, 15, 0); // within the central zone
  const outside = await api.call("canPlace", "arc", 1, 1, 0); // a corner, outside the zone

  check.expectEq("a placement inside the central zone is allowed", inside, true);
  check.expectEq("a placement outside the zone is refused", outside, false);

  await api.wait(80);
  await api.screenshot("zone");
  return check.verdict();
}
