// controls.move-left: holding Left drives the forager left a corridor.
//
// The helper is split across the runtime's seam: `arrangeMoveKey` poses the forager on
// a tile with somewhere to go (instant), and `actMoveKey` holds the key and runs the
// real sim — so the clip is the forager actually swimming under a held key.
import { arrangeMoveKey, actMoveKey, movedAlong } from "../_helpers.mjs";

export default function item() {
  let out;

  return {
    id: "controls.move-left",

    async arrange(api) {
      await arrangeMoveKey(api, "left");
    },

    async act(api) {
      out = await actMoveKey(api, "ArrowLeft");
    },

    async assert(api, check) {
      check.expectEq(
        "holding ArrowLeft gives the forager a leftward heading",
        out.after.dir,
        "left",
      );
      check.expectOk(
        "holding ArrowLeft moves the forager left a tile",
        movedAlong(out.before, out.after, "left"),
      );
    },
  };
}
