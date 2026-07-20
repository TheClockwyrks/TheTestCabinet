// Automated validation for cursor.costs-life-foe: a foe touching the cursor costs a
// life.
//
// A foe posed on the cursor's position with lives to spare is the precondition; the
// life loss is produced by the real checkCursorHit when the sim steps, read back as
// a decremented life count.

import { freshBoard, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cursor.costs-life-foe");

  await freshBoard(api);
  await api.call("setLives", 3);
  await api.call("setCursor", 640, 688);
  await api.call("spawnFoe", "glitch", { x: 640, y: 688, vx: 0 }); // on the cursor

  check.expectEq("three lives before the hit", (await api.snapshot()).lives, 3);
  await api.step(0.05);
  check.expectEq("a foe reaching the cursor costs a life", (await api.snapshot()).lives, 2);

  // A live clip of a glitch descending onto the cursor.
  await freshBoard(api);
  await api.call("setLives", 3);
  await api.call("setCursor", 640, 688);
  await api.call("spawnFoe", "glitch", { x: 640, y: 600, vx: 0 });
  await liveClip(api, 1500);

  return check.verdict();
}
