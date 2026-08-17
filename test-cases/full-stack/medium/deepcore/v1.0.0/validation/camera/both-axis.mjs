// Automated validation for camera.both-axis.
//
// The mine is wider than the viewport, so the camera follows the miner horizontally as well as
// vertically, clamped so it never scrolls past the world's edges. We place the miner deep and
// off-center (camera follows both ways) and again at the top-left corner (camera clamps).

import { teleportInto, newRun, STAGE_W, TILE } from "../_helpers.mjs";

/** The mine is `32` columns of `80 px` (`specs/world.md`), so the world is `2560 px` wide against
 *  the `1280 px` stage and a camera clamped at the RIGHT edge sits at exactly `2560 - 1280`. */
const WORLD_COLS = 32;
const CAMERA_X_MAX = WORLD_COLS * TILE - STAGE_W;

export default function item() {
  let deep;
  let right;
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
    // Three placements, each held for a beat of live play so the travel between them is legible.
    // The camera is read the instant after each teleport, before that beat, so the reading is of
    // the settled follow position rather than of anything the sim did afterwards.
    async act(api) {
      await teleportInto(api, 20, 300); // deep and right of center — follows on both axes
      deep = (await api.snapshot()).camera;
      await api.advance(60); // 60 ticks = 1 s

      await teleportInto(api, 29, 300); // hard against the right edge — the camera must clamp
      right = (await api.snapshot()).camera;
      await api.advance(60);

      await teleportInto(api, 2, 5); // top-left corner — clamps the other way
      corner = (await api.snapshot()).camera;
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectGt("the camera scrolled right to follow", deep.x, 200);
      check.expectGt("the camera scrolled down to follow", deep.y, 1000);
      // The item is "follows in both axes, CLAMPED AT THE EDGE", and only one of the two horizontal
      // edges was ever exercised: column 20 of 32 does not reach the clamp (the camera wants
      // `1640 - 640 = 1000`, well inside it), and column 2 tests the left. A build that clamps on
      // the left but runs off the right — showing empty space past the last column — passed. The
      // limit is fixed by the geometry in `specs/world.md`, not by the reference's choices.
      check.expectEq(
        "the camera clamps at the right edge",
        right.x,
        CAMERA_X_MAX,
      );
      check.expectEq("the camera clamps at the left edge", corner.x, 0);
      check.expectLt("the camera rises back near the top", corner.y, 300);
    },
  };
}
