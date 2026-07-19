// Automated validation for the Casing sub-item `no-build`.
//
// No tower can be built off the tile grid onto the enclosing casing wall
// (specs/reactor.md). The grid is 50 columns wide (0..49); a 2x2 footprint at column
// 49 would run off the grid onto the casing, so it is refused — while a footprint
// wholly on the grid is allowed.

import { newGame } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("casing.no-build");

  await newGame(api, "containment", "medium", 100000);
  const offGrid = await api.call("canPlace", "arc", 49, 18, 0); // cols 49,50 — 50 is casing
  const onGrid = await api.call("canPlace", "arc", 20, 15, 0);

  check.expectEq("a footprint running off the grid onto the casing is refused", offGrid, false);
  check.expectEq("a footprint wholly on the floor grid is allowed", onGrid, true);

  await api.wait(80);
  await api.screenshot("casing");
  return check.verdict();
}
