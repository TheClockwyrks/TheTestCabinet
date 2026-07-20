// Automated validation for the Sealing sub-item `no-trap`.
//
// A placement that would trap a unit already walking (leaving it no route) is
// refused (specs/reactor.md). We wall column 25 leaving one two-tile gap, spawn a
// real Mote walking toward that last opening, and confirm the placement that would
// close the gap on the walking unit is refused.

import { newGame, build, spawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sealing.no-trap");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  for (const row of [0, 2, 4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 26, 28, 30, 32, 34]) {
    await build(api, "arc", 25, row);
  }
  const mote = await spawn(api, "mote", "left");
  // Let the Mote walk partway toward the gap.
  await stepUntil(api, (s) => s.surge.some((u) => u.id === mote && u.x > 200), 12, 0.1);

  const can = await api.call("canPlace", "arc", 25, 16, 0);
  check.expectEq("closing the gap on the walking unit is refused", can, false);

  await liveClip(api, 2000);
  return check.verdict();
}
