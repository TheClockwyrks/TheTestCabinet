// Automated validation for the Mazing sub-item `live-repath`.
//
// Placing a tower re-paths every unit already on the floor live — a walking unit
// continues from where it is on the new route, with no teleporting (specs/reactor.md).
// We let a real Mote walk into mid-field, drop a wall directly ahead of it, and
// confirm it does not jump: its position after the next step is within one step's
// travel of where it was, and it is still on the floor.

import { newGame, spawn, build, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mazing.live-repath");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await spawn(api, "mote", "left");
  const walked = await stepUntil(api, (s) => s.surge.some((u) => u.id === id && u.x > 300), 12, 0.1);
  const m0 = await unit(api, id);
  check.expectOk("the Mote walked into mid-field", walked.hit && m0 !== null);

  // Drop a wall directly ahead of the Mote, forcing a live reroute.
  await build(api, "arc", m0.col + 2, m0.row);
  await api.step(0.2);
  const m1 = await unit(api, id);

  check.expectOk("the Mote is still on the floor after the wall dropped", m1 !== null);
  // A Mote travels ~60 px/s, so 0.2 s is ~12 px — a teleport would be far larger.
  check.expectLt("the Mote did not teleport when the route changed", Math.hypot(m1.x - m0.x, m1.y - m0.y), 25);
  check.expectOk("the floor still has an open route", isFinite((await api.snapshot()).paths.left.length));

  await liveClip(api, 2000);
  return check.verdict();
}
