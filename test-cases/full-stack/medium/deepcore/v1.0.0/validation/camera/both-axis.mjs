// Automated validation for camera.both-axis.
//
// The mine is wider than the viewport, so the camera follows the miner horizontally as well as
// vertically, clamped so it never scrolls past the world's edges. We place the miner deep and
// off-center (camera follows both ways) and again at the top-left corner (camera clamps).

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("camera.both-axis");

  await newRun(api);
  await api.call("teleport", 20, 300); // deep and right of center
  const deep = (await api.snapshot()).camera;
  check.expectGt("the camera scrolled right to follow", deep.x, 200);
  check.expectGt("the camera scrolled down to follow", deep.y, 1000);

  await api.call("teleport", 2, 5); // top-left corner
  const corner = (await api.snapshot()).camera;
  check.expectEq("the camera clamps at the left edge", corner.x, 0);
  check.expectLt("the camera rises back near the top", corner.y, 300);

  await liveClip(api, 500);
  return check.verdict();
}
