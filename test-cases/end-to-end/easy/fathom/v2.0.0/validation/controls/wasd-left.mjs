// controls.wasd-left: holding A drives the forager left a corridor, like ArrowLeft.
//
// The helper is split across the runtime's seam: `arrangeMoveKey` poses the forager on
// a tile with somewhere to go (instant), and `actMoveKey` holds the key and runs the
// real sim — so the clip is the forager actually swimming under the held A key.
import { arrangeMoveKey, actMoveKey, movedAlong } from "../_helpers.mjs";

export default function item() {
  let out;

  return {
    id: "controls.wasd-left",

    async arrange(api) {
      await arrangeMoveKey(api, "left");
    },

    async act(api) {
      out = await actMoveKey(api, "KeyA");
    },

    async assert(api, check) {
      check.expectEq(
        "holding A gives the forager a leftward heading",
        out.after.dir,
        "left",
      );
      check.expectOk(
        "holding A moves the forager left a tile",
        movedAlong(out.before, out.after, "left"),
      );
    },
  };
}
