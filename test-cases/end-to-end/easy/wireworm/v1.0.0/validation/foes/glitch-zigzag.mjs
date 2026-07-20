// Automated validation for foes.glitch-zigzag: the glitch skitters in a restless
// zig-zag (its horizontal direction keeps changing) while descending.
//
// A glitch is spawned and the real updateFoe motion is stepped forward, sampling its
// velocity and height: its horizontal direction reverses (both signs are seen) and
// its vertical position increases over the window.

import { freshBoard, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.glitch-zigzag");

  await freshBoard(api, 7);
  await api.call("spawnFoe", "glitch");
  const start = (await api.snapshot()).foes[0];

  let sawPos = false;
  let sawNeg = false;
  let last = start;
  for (let i = 0; i < 40; i++) {
    await api.step(0.1);
    const f = (await api.snapshot()).foes[0];
    if (!f) break;
    if (f.vx > 0) sawPos = true;
    if (f.vx < 0) sawNeg = true;
    last = f;
  }

  check.expectOk("the glitch darts both left and right (restless zig-zag)", sawPos && sawNeg);
  check.expectGt("the glitch descends over the window", last.y, start.y);

  // A live clip of the glitch's restless zig-zag.
  await freshBoard(api, 7);
  await api.call("spawnFoe", "glitch");
  await liveClip(api, 2000);

  return check.verdict();
}
