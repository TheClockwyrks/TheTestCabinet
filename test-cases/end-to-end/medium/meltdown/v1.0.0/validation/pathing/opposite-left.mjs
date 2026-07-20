// Automated validation for the Pathing sub-item `opposite-left`.
//
// A unit entering the left vent is assigned the right (opposite) exhaust and leaves
// there, never the nearer one (specs/reactor.md). We spawn a real Mote at the left
// vent, read its assigned exhaust, and drive it across the floor to the right edge.

import { newGame, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.opposite-left");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await spawn(api, "mote", "left");
  const start = await unit(api, id);

  check.expectEq("a left-vent unit is assigned the right exhaust", start.exhaust, "right");
  check.expectEq("it enters from the left vent", start.vent, "left");

  // Drive it across to the right side of the floor (the opposite exhaust).
  const r = await stepUntil(api, (s) => s.surge.some((u) => u.id === id && u.x > 900), 30, 0.1);
  check.expectOk("it crosses to the right side of the floor", r.hit);

  await liveClip(api, 2000);
  return check.verdict();
}
