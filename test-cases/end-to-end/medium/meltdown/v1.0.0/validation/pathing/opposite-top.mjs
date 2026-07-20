// Automated validation for the Pathing sub-item `opposite-top`.
//
// A unit entering the top vent is assigned the bottom (opposite) exhaust and leaves
// there, never the nearer one (specs/reactor.md). We spawn a real Mote at the top
// vent, read its assigned exhaust, and drive it down to the bottom edge.

import { newGame, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.opposite-top");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await spawn(api, "mote", "top");
  const start = await unit(api, id);

  check.expectEq("a top-vent unit is assigned the bottom exhaust", start.exhaust, "bottom");
  check.expectEq("it enters from the top vent", start.vent, "top");

  const r = await stepUntil(api, (s) => s.surge.some((u) => u.id === id && u.y > 640), 30, 0.1);
  check.expectOk("it crosses down to the bottom of the floor", r.hit);

  await liveClip(api, 2000);
  return check.verdict();
}
