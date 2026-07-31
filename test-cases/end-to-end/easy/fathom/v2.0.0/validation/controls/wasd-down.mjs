// controls.wasd-down: holding S drives the forager down a corridor, like ArrowDown.
//
// The helper is split across the runtime's seam: `arrangeMoveKey` poses the forager on
// a tile with somewhere to go (instant), and `actMoveKey` holds the key and runs the
// real sim — so the clip is the forager actually swimming under the held S key.
import { arrangeMoveKey, actMoveKey, movedAlong } from "../_helpers.mjs";

export default function item() {
  let out;

  return {
    id: "controls.wasd-down",

    async arrange(api) {
      await arrangeMoveKey(api, "down");
    },

    async act(api) {
      out = await actMoveKey(api, "KeyS");
    },

    async assert(api, check) {
      check.expectEq(
        "holding S gives the forager a downward heading",
        out.after.dir,
        "down",
      );
      check.expectOk(
        "holding S moves the forager down a tile",
        movedAlong(out.before, out.after, "down", out.grid),
      );
    },
  };
}
