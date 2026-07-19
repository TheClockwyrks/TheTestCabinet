// Automated validation for cursor.costs-life-worm: a worm segment reaching the
// cursor costs a life.
//
// A worm segment posed on the cursor's tile with lives to spare is the precondition;
// the life loss is produced by the real checkCursorHit when the sim steps (the
// cursor is not invulnerable here), read back as a decremented life count.

import { freshBoard, liveClip, setWorm } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cursor.costs-life-worm");

  await freshBoard(api);
  await api.call("setLives", 3);
  await api.call("setCursor", 640, 688); // tile (20,19)
  await setWorm(api, [{ c: 20, r: 19 }], 1, 1); // a segment on the cursor's tile

  check.expectEq("three lives before the hit", (await api.snapshot()).lives, 3);
  await api.step(0.05);
  const snap = await api.snapshot();
  check.expectEq("a worm segment reaching the cursor costs a life", snap.lives, 2);

  // A live clip of a worm winding down onto the cursor.
  await freshBoard(api);
  await api.call("setLives", 3);
  await api.call("setCursor", 640, 688);
  await setWorm(api, [{ c: 18, r: 18 }, { c: 17, r: 18 }, { c: 16, r: 18 }], 1, 1);
  await liveClip(api, 1500);

  return check.verdict();
}
