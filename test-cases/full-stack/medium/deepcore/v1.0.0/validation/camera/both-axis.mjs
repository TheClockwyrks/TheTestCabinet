// Automated validation for camera.both-axis.
//
// The mine is wider than the viewport, so the camera follows the miner horizontally as well as
// vertically, clamped so it never scrolls past the world's edges. We place the miner deep and
// off-center (camera follows both ways) and again at the top-left corner (camera clamps).

import { teleportInto, newRun } from "../_helpers.mjs";

export default function item() {
  let deep;
  let corner;

  return {
    id: "camera.both-axis",

    async arrange(api) {
      await newRun(api);
    },

    // Both placements happen here so the clip actually shows the camera travelling. Teleport is a
    // control op (it touches no clock), and each pose is held for a beat of live play. The camera is
    // read the instant after each teleport, before that beat, so the reading is of the settled
    // follow position rather than of anything the sim did afterwards.
    async act(api) {
      await teleportInto(api, 20, 300); // deep and right of center
      deep = (await api.snapshot()).camera;
      await api.advance(30); // 30 ticks = 0.5 s, the old 500 ms clip beat

      await teleportInto(api, 2, 5); // top-left corner
      corner = (await api.snapshot()).camera;
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectGt("the camera scrolled right to follow", deep.x, 200);
      check.expectGt("the camera scrolled down to follow", deep.y, 1000);
      check.expectEq("the camera clamps at the left edge", corner.x, 0);
      check.expectLt("the camera rises back near the top", corner.y, 300);
    },
  };
}
