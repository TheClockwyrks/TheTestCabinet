// Movement: an impassable gap blocks the worker rather than letting it walk in, and a
// diagonal into the gap slides the worker along the edge on the free axis. Level 3's gap
// band (cols 12–19) sits directly right of the worker at (11, 8).

import { holdMeasure, setTile, startFresh, liveClip, tileCenterX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.blocked");
  const gapLeftEdge = 12 * 40; // x = 480, the left edge of the gap band

  await startFresh(api, 3);

  // Straight into the gap: the worker is stopped short and never enters a gap tile.
  await setTile(api, 11, 8);
  const straight = await holdMeasure(api, ["KeyD"], 1.0);
  check.expectLt("the worker is blocked short of the gap band", straight.after.x, gapLeftEdge);
  check.expectLt("blocked travel is far less than a free second (160 px)", straight.dx, 40);

  // Diagonal into the gap: x is blocked but the worker slides down the free axis.
  await setTile(api, 11, 8);
  const diag = await holdMeasure(api, ["KeyD", "KeyS"], 1.0);
  check.expectLt("x is still blocked at the gap edge on the diagonal", diag.after.x, gapLeftEdge);
  check.expectGt("the worker slides down the free axis", diag.dy, 60);

  await setTile(api, 11, 8);
  await api.call("keyDown", "KeyD");
  await api.call("keyDown", "KeyS");
  await liveClip(api, 900);
  await api.call("keyUp", "KeyD");
  await api.call("keyUp", "KeyS");
  void tileCenterX;
  return check.verdict();
}
