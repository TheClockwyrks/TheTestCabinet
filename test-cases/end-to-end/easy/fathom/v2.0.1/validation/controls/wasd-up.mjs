// controls.wasd-up: holding W drives the forager up a corridor, like ArrowUp.
//
// The helper is split across the runtime's seam: `arrangeMoveKey` poses the forager on
// a tile with somewhere to go (instant), and `actMoveKey` holds the key and runs the
// real sim — so the clip is the forager actually swimming under the held W key.
import { arrangeMoveKey, actMoveKey, movedAlong } from "../_helpers.mjs";

export default function item() {
  let out;

  return {
    id: "controls.wasd-up",

    async arrange(api) {
      await arrangeMoveKey(api, "up");
    },

    async act(api) {
      out = await actMoveKey(api, "KeyW");
    },

    async assert(api, check) {
      check.expectEq(
        "holding W gives the forager an upward heading",
        out.after.dir,
        "up",
      );
      check.expectOk(
        "holding W moves the forager up a tile",
        movedAlong(out.before, out.after, "up", out.grid),
      );
    },
  };
}
