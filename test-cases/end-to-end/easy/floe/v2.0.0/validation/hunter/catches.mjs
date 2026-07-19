// Automated validation for the Hunter item `catches`.
//
// A bear that reaches the critter catches it — a life is lost. A bear is placed on
// the tile beside a stationary critter; the real pursuit glides into it and the
// catch resolves, which the snapshot reads back. See validation/_helpers.mjs.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.catches");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("placeCritter", 20, 10); // median, solid
  await api.call("setBear", 0, { col: 21, row: 10 }); // adjacent

  const r = await stepUntil(api, (s) => s.phase === "dying", 1);
  check.expectOk("an adjacent bear catches a stationary critter", r.hit);
  check.expectEq("the phase is dying after a catch", r.snap.phase, "dying");
  check.expectEq("a life is lost to the bear", r.snap.lives, 2);

  // Clip: the bear closing the last tile and lunging, in real time.
  await startCrossing(api);
  await api.call("placeCritter", 20, 10);
  await api.call("setBear", 0, { col: 23, row: 10 });
  await api.wait(1000);

  return check.verdict();
}
