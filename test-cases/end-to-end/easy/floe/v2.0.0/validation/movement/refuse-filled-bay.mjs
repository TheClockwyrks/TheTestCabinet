// Automated validation for the Movement item `refuse-filled-bay`.
//
// Hopping up into an already-filled bay is refused, while an open bay accepts the
// hop. Both are driven through the real play code: the critter is stood on a floe
// below bay 0's column and a real up-hop is attempted, first with the bay filled
// (refused) then open (accepted). See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.refuse-filled-bay");

  // Filled bay: the hop is refused.
  await startCrossing(api);
  await api.call("setBays", [true, false, false, false, false]);
  await api.call("setLane", WATER_TOP, { cols: [3], speed: 0 }); // floe under bay 0
  await api.call("placeCritter", 3, WATER_TOP);
  await api.call("press", "ArrowUp");
  await api.step(0.15);
  let s = await api.snapshot();
  check.expectEq("a hop into a FILLED bay is refused (row unchanged)", s.critter.row, WATER_TOP);
  check.expectEq("no death", s.screen, "playing");

  // Open bay: the same hop is accepted (the bay fills).
  await startCrossing(api);
  await api.call("setBays", [false, false, false, false, false]);
  await api.call("setLane", WATER_TOP, { cols: [3], speed: 0 });
  await api.call("placeCritter", 3, WATER_TOP);
  await api.call("press", "ArrowUp");
  await api.step(0.15);
  s = await api.snapshot();
  check.expectEq("an OPEN bay accepts the hop (bay 0 fills)", s.bays[0], true);

  // Clip: the critter bumping a filled bay in real time.
  await startCrossing(api);
  await api.call("setBays", [true, false, false, false, false]);
  await api.call("setLane", WATER_TOP, { cols: [3], speed: 0 });
  await api.call("placeCritter", 3, WATER_TOP);
  await api.call("setAutoStep", true);
  await api.wait(250);
  await api.call("keyDown", "ArrowUp");
  await api.wait(500);
  await api.call("keyUp", "ArrowUp");
  await api.wait(200);

  return check.verdict();
}
