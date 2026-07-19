// Automated validation for the Pause sub-item `freezes`.
//
// While paused the simulation does not advance — the surge holds its position
// (specs/states.md). We get a real Mote moving, pause, then step; a paused sim
// ignores steps, so the Mote's position is unchanged.

import { newGame, spawn, unit, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pause.freezes");

  await newGame(api, "containment", "medium");
  await api.call("setLives", 100000);
  const id = await spawn(api, "mote", "left");
  await api.step(1); // get it moving
  const before = await unit(api, id);

  await press(api, "KeyP");
  check.expectEq("the match is paused", (await api.snapshot()).screen, "paused");
  await api.step(1); // a paused sim ignores steps
  const after = await unit(api, id);

  check.expectClose("the Mote's x holds while paused", after.x, before.x, 0.01);
  check.expectClose("the Mote's y holds while paused", after.y, before.y, 0.01);

  await api.wait(120);
  await api.screenshot("frozen");
  return check.verdict();
}
