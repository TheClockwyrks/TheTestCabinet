// Automated validation for the Star-core item `rock-recycled`: a rock pulled into the
// star is destroyed and immediately replaced by a same-size rock entering from the edge,
// so the number of rocks is conserved and no points are scored. A single rock is aimed
// into the core; the real sim runs until the star recycles it, and the field is read.

import { newGame, stepUntilRecycled, distToStar, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("star-core.rock-recycled");

  await newGame(api);
  await api.call("setScore", 0);
  await api.call("addRock", "small", { x: 640, y: 200, vx: 0, vy: 240 });

  const { recycled, snap } = await stepUntilRecycled(api, { maxSeconds: 2 });

  check.expectOk("the rock is recycled by the star (relocated to an edge)", recycled);
  check.expectEq("the rock count is conserved — one out, one in", snap.rocks.length, 1);
  check.expectGt("the replacement enters from far off, not through the center", distToStar(snap.rocks[0]), 150);
  check.expectEq("recycling a rock scores nothing", snap.score, 0);

  await newGame(api);
  await api.call("addRock", "small", { x: 640, y: 200, vx: 0, vy: 240 });
  await liveClip(api, 900);
  return check.verdict();
}
